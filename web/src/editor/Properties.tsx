import { EASINGS, ENTER_PRESETS, EXIT_PRESETS, TEMPLATE_SLOTS, type Layer, type ProjectDocument } from '@bannerfront/shared';
import { useRef } from 'react';
import { ColorField, NumField, Section, SelectField } from './fields';
import { fmtSeconds } from './ops';

export interface FontOption {
  id: string;
  family: string;
  style: string;
  weight: number;
  italic: boolean;
}

const PRESET_LABEL: Record<string, string> = {
  'fade-in': 'Aparecer (fade)',
  'slide-in-left': 'Deslizar da esquerda',
  'slide-in-right': 'Deslizar da direita',
  'slide-in-top': 'Deslizar de cima',
  'slide-in-bottom': 'Deslizar de baixo',
  'zoom-in': 'Zoom (entrando)',
  'fade-out': 'Sumir (fade)',
  'slide-out-left': 'Sair para a esquerda',
  'slide-out-right': 'Sair para a direita',
  'slide-out-top': 'Sair para cima',
  'slide-out-bottom': 'Sair para baixo',
  'zoom-out': 'Zoom (saindo)',
};

const EASING_LABEL: Record<string, string> = {
  linear: 'Linear',
  ease: 'Suave',
  'ease-in': 'Acelera',
  'ease-out': 'Desacelera',
  'ease-in-out': 'Acelera e desacelera',
};

const SLOT_LABEL: Record<string, string> = {
  logo: 'Logo',
  headline: 'Título (headline)',
  'cta-text': 'Texto do botão (CTA)',
  'hero-image': 'Imagem principal',
};

const easingOptions = EASINGS.map((e) => ({ value: e, label: EASING_LABEL[e] ?? e }));

interface Props {
  layer: Layer;
  doc: ProjectDocument;
  fonts: FontOption[];
  readOnly: boolean;
  canTemplate: boolean;
  onChange(patch: Record<string, unknown>, coalesce?: string): void;
  onUploadImage(file: File): void;
}

export function Properties({ layer, doc, fonts, readOnly, canTemplate, onChange, onUploadImage }: Props) {
  const key = (field: string) => `${layer.id}:${field}`;
  const set = (field: string, value: unknown) => onChange({ [field]: value }, key(field));
  const fileInput = useRef<HTMLInputElement>(null);
  const slide = doc.slides.find((s) => s.id === layer.slideId);

  const fontOptions = fonts.map((f) => ({ value: f.id, label: `${f.family} — ${f.style}` }));
  const hasFont = fonts.some((f) => 'fontId' in layer && f.id === layer.fontId);
  const withBlankFont = hasFont ? fontOptions : [{ value: '', label: 'Escolha uma fonte…' }, ...fontOptions];

  const pickFont = (fontId: string) => {
    const font = fonts.find((f) => f.id === fontId);
    onChange({ fontId, ...(font ? { fontWeight: font.weight } : {}) }, key('font'));
  };

  const setEnter = (patch: Record<string, unknown>) =>
    onChange({ enter: { ...(layer.enter ?? { preset: 'fade-in', durationMs: 500, delayMs: 0, easing: 'ease-out' }), ...patch } }, key('enter'));
  const setExit = (patch: Record<string, unknown>) =>
    onChange({ exit: { ...(layer.exit ?? { preset: 'fade-out', durationMs: 500, delayMs: 0, easing: 'ease-in' }), ...patch } }, key('exit'));

  return (
    <fieldset className="props" disabled={readOnly}>
      <label className="f wide">
        <span>Nome da camada</span>
        <input value={layer.name} maxLength={120} onChange={(e) => set('name', e.target.value || layer.name)} />
      </label>

      <Section title="Posição e tamanho">
        <NumField label="X" value={layer.x} onChange={(v) => set('x', Math.round(v))} unit="px" />
        <NumField label="Y" value={layer.y} onChange={(v) => set('y', Math.round(v))} unit="px" />
        <NumField label="Largura" value={layer.width} min={1} onChange={(v) => v > 0 && set('width', Math.round(v))} unit="px" />
        <NumField label="Altura" value={layer.height} min={1} onChange={(v) => v > 0 && set('height', Math.round(v))} unit="px" />
        <NumField label="Rotação" value={layer.rotation} onChange={(v) => set('rotation', v)} unit="°" />
        <NumField
          label="Opacidade"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          onChange={(v) => set('opacity', Math.max(0, Math.min(100, v)) / 100)}
          unit="%"
        />
      </Section>

      {layer.type === 'text' && (
        <Section title="Texto">
          <label className="f wide">
            <span>Conteúdo</span>
            <textarea value={layer.text} rows={3} maxLength={2000} onChange={(e) => set('text', e.target.value)} />
          </label>
          <SelectField label="Fonte" value={layer.fontId} options={withBlankFont} onChange={pickFont} />
          <NumField label="Tamanho" value={layer.fontSize} min={1} onChange={(v) => v > 0 && set('fontSize', v)} unit="px" />
          <ColorField label="Cor" value={layer.color} onChange={(v) => set('color', v)} />
          <NumField label="Entrelinha" value={layer.lineHeight} min={0.5} step={0.05} onChange={(v) => v > 0 && set('lineHeight', v)} />
          <NumField label="Espaço entre letras" value={layer.letterSpacing} step={0.5} onChange={(v) => set('letterSpacing', v)} unit="px" />
          <SelectField
            label="Alinhamento"
            value={layer.align}
            options={[
              { value: 'left', label: 'Esquerda' },
              { value: 'center', label: 'Centro' },
              { value: 'right', label: 'Direita' },
            ]}
            onChange={(v) => set('align', v)}
          />
        </Section>
      )}

      {layer.type === 'button' && (
        <Section title="Botão">
          <label className="f wide">
            <span>Texto</span>
            <input value={layer.label} maxLength={200} onChange={(e) => set('label', e.target.value)} />
          </label>
          <SelectField label="Fonte" value={layer.fontId} options={withBlankFont} onChange={pickFont} />
          <NumField label="Tamanho" value={layer.fontSize} min={1} onChange={(v) => v > 0 && set('fontSize', v)} unit="px" />
          <ColorField label="Cor do texto" value={layer.textColor} onChange={(v) => set('textColor', v)} />
          <ColorField label="Cor do botão" value={layer.fill} onChange={(v) => set('fill', v)} />
          <NumField label="Cantos" value={layer.radius} min={0} onChange={(v) => v >= 0 && set('radius', v)} unit="px" />
          <p className="muted small wide">O botão é só visual: o clique em qualquer ponto do banner abre o link da campanha.</p>
        </Section>
      )}

      {layer.type === 'shape' && (
        <Section title="Forma">
          <SelectField
            label="Tipo"
            value={layer.shape === 'path' ? 'rect' : layer.shape}
            options={[
              { value: 'rect', label: 'Retângulo' },
              { value: 'ellipse', label: 'Elipse' },
            ]}
            onChange={(v) => set('shape', v)}
          />
          <ColorField label="Preenchimento" value={layer.fill} nullable onClear={() => set('fill', null)} onChange={(v) => set('fill', v)} />
          <ColorField label="Contorno" value={layer.stroke} nullable onClear={() => set('stroke', null)} onChange={(v) => onChange({ stroke: v, strokeWidth: layer.strokeWidth || 2 }, key('stroke'))} />
          <NumField label="Espessura" value={layer.strokeWidth} min={0} onChange={(v) => v >= 0 && set('strokeWidth', v)} unit="px" />
          {layer.shape === 'rect' && <NumField label="Cantos" value={layer.radius} min={0} onChange={(v) => v >= 0 && set('radius', v)} unit="px" />}
        </Section>
      )}

      {layer.type === 'image' && (
        <Section title="Imagem">
          <p className="muted small wide">
            {doc.assets[layer.assetId]
              ? `${doc.assets[layer.assetId]!.fileName} · ${doc.assets[layer.assetId]!.width}x${doc.assets[layer.assetId]!.height}`
              : 'Imagem não encontrada.'}
          </p>
          <div className="wide">
            <button type="button" onClick={() => fileInput.current?.click()}>Trocar imagem</button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onUploadImage(file);
              }}
            />
          </div>
          <SelectField
            label="Ajuste"
            value={layer.fit}
            options={[
              { value: 'cover', label: 'Preencher (recorta)' },
              { value: 'contain', label: 'Caber inteira' },
              { value: 'fill', label: 'Esticar' },
            ]}
            onChange={(v) => set('fit', v)}
          />
          {layer.fit === 'cover' && (
            <>
              <NumField label="Foco horizontal" value={Math.round(layer.focus.x * 100)} min={0} max={100} onChange={(v) => set('focus', { ...layer.focus, x: Math.max(0, v) / 100 })} unit="%" />
              <NumField label="Foco vertical" value={Math.round(layer.focus.y * 100)} min={0} max={100} onChange={(v) => set('focus', { ...layer.focus, y: Math.max(0, v) / 100 })} unit="%" />
            </>
          )}
        </Section>
      )}

      <Section title="Entrada">
        <SelectField
          label="Animação"
          value={layer.enter?.preset ?? ('none' as never)}
          options={[{ value: 'none' as never, label: 'Nenhuma' }, ...ENTER_PRESETS.map((p) => ({ value: p, label: PRESET_LABEL[p] ?? p }))]}
          onChange={(v) => (v === ('none' as string) ? onChange({ enter: null }, key('enter')) : setEnter({ preset: v }))}
        />
        {layer.enter && (
          <>
            <NumField label="Duração" value={layer.enter.durationMs / 1000} min={0} step={0.1} onChange={(v) => v >= 0 && setEnter({ durationMs: Math.round(v * 1000) })} unit="s" />
            <NumField label="Atraso" value={layer.enter.delayMs / 1000} min={0} step={0.1} onChange={(v) => v >= 0 && setEnter({ delayMs: Math.round(v * 1000) })} unit="s" />
            <SelectField label="Aceleração" value={layer.enter.easing} options={easingOptions} onChange={(v) => setEnter({ easing: v })} />
          </>
        )}
      </Section>

      <Section title="Saída">
        <SelectField
          label="Animação"
          value={layer.exit?.preset ?? ('none' as never)}
          options={[{ value: 'none' as never, label: 'Nenhuma' }, ...EXIT_PRESETS.map((p) => ({ value: p, label: PRESET_LABEL[p] ?? p }))]}
          onChange={(v) => (v === ('none' as string) ? onChange({ exit: null }, key('exit')) : setExit({ preset: v }))}
        />
        {layer.exit && (
          <>
            <NumField label="Duração" value={layer.exit.durationMs / 1000} min={0} step={0.1} onChange={(v) => v >= 0 && setExit({ durationMs: Math.round(v * 1000) })} unit="s" />
            <SelectField label="Aceleração" value={layer.exit.easing} options={easingOptions} onChange={(v) => setExit({ easing: v })} />
          </>
        )}
        <p className="muted small wide">A saída termina no fim do tempo da camada.</p>
      </Section>

      <Section title="Tempo em tela">
        <NumField
          label="Aparece em"
          value={layer.timing.startMs / 1000}
          min={0}
          step={0.1}
          onChange={(v) => v >= 0 && onChange({ timing: { ...layer.timing, startMs: Math.round(v * 1000) } }, key('timing'))}
          unit="s"
        />
        <NumField
          label="Some em"
          value={layer.timing.endMs / 1000}
          min={0}
          step={0.1}
          onChange={(v) => v >= 0 && onChange({ timing: { ...layer.timing, endMs: Math.round(v * 1000) } }, key('timing'))}
          unit="s"
        />
        <p className="muted small wide">
          {slide ? `Tela: ${slide.name} (${fmtSeconds(slide.startMs)}–${fmtSeconds(slide.startMs + slide.durationMs)} s). ` : 'Sem tela (vale para o banner todo). '}
          Para a camada ficar fixa o tempo todo, deixe sem animação e vá de 0 até o fim.
        </p>
      </Section>

      {canTemplate && (
        <Section title="Template (Fase 2)">
          <SelectField
            label="Campo editável"
            value={layer.templateSlot ?? ('none' as never)}
            options={[{ value: 'none' as never, label: 'Nenhum (camada fixa)' }, ...TEMPLATE_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] ?? s }))]}
            onChange={(v) => onChange({ templateSlot: v === ('none' as string) ? null : v }, key('slot'))}
          />
        </Section>
      )}
    </fieldset>
  );
}
