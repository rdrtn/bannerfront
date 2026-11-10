import fs from 'node:fs/promises';
import {
  buildBannerHtml,
  checkProject,
  findFormat,
  maxBytesFor,
  migrateProject,
  projectDocumentSchema,
  projectPassDurationMs,
  projectTotalDurationMs,
  zipNameAvulsa,
  zipNameDivulgacao,
  type Layer,
  type OutlineFont,
  type ProjectDocument,
} from '@bannerfront/shared';
import { zipSync } from 'fflate';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { fontFilePath } from './routes/fonts.js';
import { parseFont } from './fonts.js';
import { optimizeImage, type ImageUse } from './images.js';
import { findAsset } from './storage.js';

export interface ExportRow {
  id: string;
  name: string;
  client: string | null;
  subject: string | null;
  media: 'divulgacao' | 'avulsa';
  created_at: Date;
  data: unknown;
}

export interface ExportFile {
  name: string;
  bytes: number;
}

export interface ExportReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  zipName: string | null;
  files: ExportFile[];
  /** Soma dos arquivos sem compressão. */
  totalBytes: number;
  maxBytes: number;
  overBudget: boolean;
  /** Qualidade (1 a 100) usada nas imagens depois do ajuste automático; null se não há imagens. */
  imageQuality: number | null;
  passMs: number;
  /** Duração total com os loops; null se infinito. */
  totalDurationMs: number | null;
}

export interface ExportResult {
  report: ExportReport;
  /** ZIP pronto; ausente quando há erros. */
  zip: Uint8Array | null;
}

/** Qualidades tentadas em ordem até caber no peso máximo. */
const QUALITY_LADDER = [88, 80, 72, 64, 56, 48, 40];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function zipNameFor(row: ExportRow, doc: ProjectDocument): { name: string | null; error?: string } {
  const format = findFormat(doc.formatId);
  const client = row.client?.trim();
  if (!client) return { name: null, error: 'Informe o cliente do projeto: ele faz parte do nome do ZIP.' };

  try {
    if (row.media === 'divulgacao') {
      if (!format) return { name: null, error: 'Mídia de divulgação precisa de um dos formatos padrão.' };
      return { name: zipNameDivulgacao({ formatAbbr: format.abbr, client, createdAt: row.created_at }) };
    }
    const subject = row.subject?.trim();
    if (!subject) return { name: null, error: 'Informe o assunto do projeto: ele faz parte do nome do ZIP da mídia avulsa.' };
    const formato = format ? format.abbr : `${doc.canvas.width}x${doc.canvas.height}`;
    return { name: zipNameAvulsa({ formato, client, subject, createdAt: row.created_at }) };
  } catch (err) {
    return { name: null, error: (err as Error).message };
  }
}

async function loadFonts(pool: Pool, config: Config, doc: ProjectDocument): Promise<Record<string, OutlineFont>> {
  const ids = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.visible && (layer.type === 'text' || layer.type === 'button') && UUID.test(layer.fontId)) ids.add(layer.fontId);
  }
  if (ids.size === 0) return {};
  const { rows } = await pool.query<{ id: string; sha256: string; format: 'ttf' | 'otf' | 'woff' }>(
    'SELECT id, sha256, format FROM fonts WHERE id = ANY($1::uuid[])',
    [[...ids]],
  );
  const fonts: Record<string, OutlineFont> = {};
  for (const row of rows) {
    try {
      fonts[row.id] = parseFont(await fs.readFile(fontFilePath(config.dataDir, row))) as unknown as OutlineFont;
    } catch {
      // fica sem a fonte; o HTML avisa
    }
  }
  return fonts;
}

type ImageLayer = Extract<Layer, { type: 'image' }>;

/** Gera o ZIP do banner e o relatório de peso. Não altera nada no banco. */
export async function buildExport(pool: Pool, config: Config, row: ExportRow): Promise<ExportResult> {
  const empty: ExportReport = {
    ok: false,
    errors: [],
    warnings: [],
    zipName: null,
    files: [],
    totalBytes: 0,
    maxBytes: 0,
    overBudget: false,
    imageQuality: null,
    passMs: 0,
    totalDurationMs: null,
  };

  let doc: ProjectDocument;
  try {
    doc = projectDocumentSchema.parse(migrateProject(row.data));
  } catch {
    return { report: { ...empty, errors: ['O projeto salvo está inválido.'] }, zip: null };
  }

  const issues = checkProject(doc);
  const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
  const warnings = issues.filter((i) => i.severity === 'warning').map((i) => i.message);
  const maxBytes = maxBytesFor(doc.formatId);
  const passMs = projectPassDurationMs(doc);
  const base: ExportReport = { ...empty, maxBytes, passMs, totalDurationMs: projectTotalDurationMs(doc) };

  const zipName = zipNameFor(row, doc);
  if (zipName.error) errors.push(zipName.error);
  if (doc.layers.every((l) => !l.visible)) errors.push('O projeto não tem nenhuma camada visível.');
  if (errors.length > 0) return { report: { ...base, errors, warnings, zipName: zipName.name }, zip: null };

  // Imagens usadas por camadas visíveis, na ordem do primeiro uso.
  const usage = new Map<string, ImageUse[]>();
  for (const layer of doc.layers) {
    if (!layer.visible || layer.type !== 'image') continue;
    const l = layer as ImageLayer;
    const list = usage.get(l.assetId) ?? [];
    list.push({ width: l.width, height: l.height, fit: l.fit, focus: l.focus });
    usage.set(l.assetId, list);
  }

  const sources = new Map<string, Buffer>();
  for (const assetId of usage.keys()) {
    const found = await findAsset(config, row.id, assetId);
    if (found) sources.set(assetId, await fs.readFile(found.file));
  }

  const fonts = await loadFonts(pool, config, doc);

  // Tenta qualidades cada vez menores até caber no peso máximo.
  let best: { files: Map<string, Buffer>; html: string; names: Map<string, string>; quality: number | null; htmlWarnings: string[] } | null = null;
  const ladder = sources.size > 0 ? QUALITY_LADDER : [null];
  for (const quality of ladder) {
    const files = new Map<string, Buffer>();
    const names = new Map<string, string>();
    let n = 0;
    for (const [assetId, source] of sources) {
      const optimized = await optimizeImage(source, usage.get(assetId)!, quality ?? 88);
      n += 1;
      const fileName = `${n}.${optimized.ext}`;
      files.set(fileName, optimized.data);
      names.set(assetId, fileName);
    }
    const built = buildBannerHtml({
      doc,
      title: zipName.name!,
      assetSrc: (id) => names.get(id) ?? null,
      fonts,
      mode: 'export',
    });
    best = { files, html: built.html, names, quality, htmlWarnings: built.warnings };
    const total = Buffer.byteLength(built.html) + [...files.values()].reduce((s, b) => s + b.length, 0);
    if (total <= maxBytes) break;
  }

  const out = best!;
  const htmlBuf = Buffer.from(out.html, 'utf8');
  const fileList: ExportFile[] = [{ name: 'index.html', bytes: htmlBuf.length }];
  for (const [name, data] of out.files) fileList.push({ name, bytes: data.length });
  const totalBytes = fileList.reduce((s, f) => s + f.bytes, 0);
  const overBudget = totalBytes > maxBytes;

  warnings.push(...out.htmlWarnings);
  if (overBudget) {
    warnings.push(
      `O banner pesa ${(totalBytes / 1000).toFixed(1)} KB e o limite do formato é ${(maxBytes / 1000).toFixed(0)} KB, mesmo com as imagens no menor ajuste automático. Reduza imagens, textos ou o número de camadas.`,
    );
  }

  const zipInput: Record<string, Uint8Array> = { 'index.html': htmlBuf };
  for (const [name, data] of out.files) zipInput[name] = data;
  const zip = zipSync(zipInput, { level: 9, mtime: row.created_at });

  return {
    report: {
      ...base,
      ok: true,
      warnings,
      zipName: zipName.name,
      files: fileList,
      totalBytes,
      overBudget,
      imageQuality: out.quality,
    },
    zip,
  };
}

