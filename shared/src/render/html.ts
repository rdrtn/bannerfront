import type { Layer, ProjectDocument } from '../project';
import { layoutText, textPathData, type OutlineFont } from './text';
import {
  buildPassStops,
  isStaticLayer,
  keyframesCss,
  loopPlan,
  stopsEqual,
} from './timeline';
import { escapeHtml, num, svgPaint } from './util';

export interface BuildHtmlOptions {
  doc: ProjectDocument;
  title: string;
  /** URL ou nome de arquivo da imagem; `null` se não existir. */
  assetSrc(assetId: string): string | null;
  /** Fontes já lidas, por id de fonte cadastrada. */
  fonts: Record<string, OutlineFont | undefined>;
  /**
   * `export`: HTML final (clickTag no link).
   * `preview`: igual, mas o clique não abre nada (usado no editor).
   */
  mode?: 'export' | 'preview';
}

export interface BuiltHtml {
  html: string;
  /** Problemas que não impedem gerar, mas que o usuário deve ver. */
  warnings: string[];
  passMs: number;
  /** Camadas que ficaram de fora (ocultas ou com problema). */
  skipped: string[];
}

function svgOpen(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" style="overflow:visible">`;
}

function shapeMarkup(layer: Extract<Layer, { type: 'shape' }>): string {
  const sw = layer.stroke && layer.strokeWidth > 0 ? layer.strokeWidth : 0;
  const paint = `${svgPaint('fill', layer.fill)}${sw ? `${svgPaint('stroke', layer.stroke)} stroke-width="${num(sw)}"` : ''}`;
  const half = sw / 2;
  let body: string;
  if (layer.shape === 'ellipse') {
    body = `<ellipse cx="${num(layer.width / 2)}" cy="${num(layer.height / 2)}" rx="${num(Math.max(0, layer.width / 2 - half))}" ry="${num(Math.max(0, layer.height / 2 - half))}"${paint}/>`;
  } else if (layer.shape === 'path') {
    body = `<path d="${escapeHtml(layer.path ?? '')}"${paint}/>`;
  } else {
    const r = Math.min(layer.radius, (layer.width - sw) / 2, (layer.height - sw) / 2);
    body = `<rect x="${num(half)}" y="${num(half)}" width="${num(Math.max(0, layer.width - sw))}" height="${num(Math.max(0, layer.height - sw))}"${r > 0 ? ` rx="${num(r)}"` : ''}${paint}/>`;
  }
  return `${svgOpen(layer.width, layer.height)}${body}</svg>`;
}

function textMarkup(layer: Extract<Layer, { type: 'text' }>, font: OutlineFont): string {
  const style = {
    fontSize: layer.fontSize,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
    align: layer.align,
  };
  const layout = layoutText(font, layer.text, layer.width, style);
  const d = textPathData(font, layout, style);
  return `${svgOpen(layer.width, layer.height)}<path d="${d}"${svgPaint('fill', layer.color)}/></svg>`;
}

function buttonMarkup(layer: Extract<Layer, { type: 'button' }>, font: OutlineFont | undefined): string {
  const r = Math.min(layer.radius, layer.width / 2, layer.height / 2);
  let label = '';
  if (font && layer.label.trim()) {
    const style = { fontSize: layer.fontSize, lineHeight: 1, letterSpacing: 0, align: 'center' as const };
    const layout = layoutText(font, layer.label, layer.width, style);
    // Centraliza o bloco de texto na vertical.
    const offset = (layer.height - layout.height) / 2;
    const shifted = { ...layout, lines: layout.lines.map((l) => ({ ...l, baseline: l.baseline + offset })) };
    label = `<path d="${textPathData(font, shifted, style)}"${svgPaint('fill', layer.textColor)}/>`;
  }
  return `${svgOpen(layer.width, layer.height)}<rect width="${num(layer.width)}" height="${num(layer.height)}"${r > 0 ? ` rx="${num(r)}"` : ''}${svgPaint('fill', layer.fill)}/>${label}</svg>`;
}

function imageMarkup(layer: Extract<Layer, { type: 'image' }>, src: string): string {
  const position = `${num(layer.focus.x * 100)}% ${num(layer.focus.y * 100)}%`;
  return `<img src="${escapeHtml(src)}" alt="" style="width:100%;height:100%;object-fit:${layer.fit};object-position:${position}">`;
}

/**
 * Gera o HTML5 do banner: CSS e JS dentro do arquivo, texto como contorno SVG,
 * animações em CSS pré-calculadas e clique no banner inteiro (clickTag).
 * É o mesmo código para o editor (pré-visualização) e para a exportação.
 */
export function buildBannerHtml(options: BuildHtmlOptions): BuiltHtml {
  const { doc, title, assetSrc, fonts } = options;
  const { width, height } = doc.canvas;
  const plan = loopPlan(doc);
  const passMs = plan.passMs;
  const warnings: string[] = [];
  const skipped: string[] = [];
  const css: string[] = [];
  const parts: string[] = [];

  doc.layers.forEach((layer, i) => {
    if (!layer.visible) {
      skipped.push(layer.name);
      return;
    }

    let content: string | null = null;
    switch (layer.type) {
      case 'shape':
        content = shapeMarkup(layer);
        break;
      case 'text': {
        const font = fonts[layer.fontId];
        if (!font) warnings.push(`A camada "${layer.name}" usa uma fonte que não está disponível.`);
        else if (layer.text.trim()) content = textMarkup(layer, font);
        break;
      }
      case 'button': {
        const font = fonts[layer.fontId];
        if (!font) warnings.push(`O botão "${layer.name}" usa uma fonte que não está disponível; o texto ficou de fora.`);
        content = buttonMarkup(layer, font);
        break;
      }
      case 'image': {
        const src = assetSrc(layer.assetId);
        if (!src) warnings.push(`A camada "${layer.name}" usa uma imagem que não está disponível.`);
        else content = imageMarkup(layer, src);
        break;
      }
    }
    if (content === null) {
      skipped.push(layer.name);
      return;
    }

    const box = [
      `left:${num(layer.x)}px`,
      `top:${num(layer.y)}px`,
      `width:${num(layer.width)}px`,
      `height:${num(layer.height)}px`,
      layer.opacity < 1 ? `opacity:${num(layer.opacity)}` : '',
      layer.rotation ? `transform:rotate(${num(layer.rotation)}deg)` : '',
    ]
      .filter(Boolean)
      .join(';');

    if (passMs <= 0 || isStaticLayer(layer, passMs)) {
      parts.push(`<div class="l" style="${box}">${content}</div>`);
      return;
    }

    const name = `k${i}`;
    const canvas = { width, height };
    const stopsA = buildPassStops(layer, canvas, passMs, false);
    const stopsB = buildPassStops(layer, canvas, passMs, true);
    let animation: string;
    if (plan.passes === null) {
      css.push(keyframesCss(name, stopsA, passMs));
      animation = `${name} ${passMs}ms linear infinite`;
    } else if (plan.passes === 1) {
      css.push(keyframesCss(name, stopsB, passMs));
      animation = `${name} ${passMs}ms linear 1 forwards`;
    } else if (stopsEqual(stopsA, stopsB)) {
      css.push(keyframesCss(name, stopsA, passMs));
      animation = `${name} ${passMs}ms linear ${plan.passes} forwards`;
    } else {
      // Passadas normais, depois uma última que termina no quadro final.
      css.push(keyframesCss(name, stopsA, passMs), keyframesCss(`${name}f`, stopsB, passMs));
      animation =
        `${name} ${passMs}ms linear ${plan.passes - 1},` +
        `${name}f ${passMs}ms linear ${(plan.passes - 1) * passMs}ms 1 forwards`;
    }
    css.push(`.go #a${i}{animation:${animation}}`);
    parts.push(`<div class="l" style="${box}"><div class="a" id="a${i}">${content}</div></div>`);
  });

  const href =
    options.mode === 'preview' ? `href="#" onclick="return false"` : `href="javascript:window.open(window.clickTag,'_blank');void(0);"`;

  const html =
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<meta name="ad.size" content="width=${width},height=${height}">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>html,body{margin:0;padding:0;overflow:hidden}a{display:block;text-decoration:none;cursor:pointer}` +
    `#ad{position:relative;overflow:hidden;width:${width}px;height:${height}px;background:${doc.canvas.background.slice(0, 7)}}` +
    `.l{position:absolute}.l svg,.l img{display:block}.a{width:100%;height:100%;opacity:0}` +
    `${css.join('')}</style>` +
    `<script>var clickTag="";</script></head><body>` +
    `<a ${href}><div id="ad">${parts.join('')}</div></a>` +
    `<script>window.addEventListener("load",function(){document.getElementById("ad").className="go"});</script>` +
    `</body></html>`;

  return { html, warnings, passMs, skipped };
}
