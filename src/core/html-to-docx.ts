// Adapted from bruce-doc-converter; per-conversion state replaces its globals.
import { JSDOM } from 'jsdom';
import { Paragraph, TextRun, ImageRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, HeadingLevel, VerticalAlign, Bookmark, InternalHyperlink, FootnoteReferenceRun, SimpleField, TableLayoutType } from 'docx';
import type { ParagraphChild, IRunOptions, INumberingOptions } from 'docx';
import { PAGE_WIDTH, PAGE_HEIGHT, MAX_IMAGE_HEIGHT, numberingLevels, charsToTwips } from './styles.js';
import { documentDefaults, parseDocumentOptions, mmToTwips } from './document-options.js';
import type { DocumentOptions } from './document-options.js';
import { columnWidths, estimatedLines } from './layout.js';
import type { Diagnostics } from './diagnostics.js';
export interface EmbeddedImage { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number; displayWidth?: number }
export interface ImageBounds { maxWidth: number; maxHeight: number }
type Block = Paragraph | Table;
// All horizontal layout is computed in twips; ImageRun uses 96-DPI pixels.
interface Layout { left: number; right: number; quote: boolean }
const rootLayout: Layout = { left: 0, right: 0, quote: false };
const headingSlug = (text: string): string => text.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
export function convertHTMLToDocx(html: string, images: Map<string, EmbeddedImage>, diagnostics: Diagnostics, formulas = new Map<string, ParagraphChild[]>(), onImageBounds?: (id: string, bounds: ImageBounds) => void): { children: Block[]; sections: { landscape: boolean; children: Block[] }[]; options: DocumentOptions; numbering: INumberingOptions; footnotes: Record<string, { children: Paragraph[] }> } {
  const dom = new JSDOM(`<body>${html}</body>`);
  let options = documentDefaults();
  let landscape = false;
  const contentWidth = (): number => (landscape ? PAGE_HEIGHT : PAGE_WIDTH) - mmToTwips(options.margins.left) - mmToTwips(options.margins.right);
  const availablePixels = (layout: Layout): number => Math.max(1, (contentWidth() - layout.left - layout.right) / 15);
  const numbering: INumberingOptions['config'][number][] = [];
  let nextList = 0;
  let sectionLevel = 0;
  let section = 0;
  let autoList: string | undefined;
  const namedLists = new Map<string, { reference: string; level: number; left: number }>();
  const footnotes: Record<string, { children: Paragraph[] }> = {};
  const referencedNotes = new Set<string>();
  const noteNumbers = new Map<string, number>();
  const noteElements = new Map<string, Element>();
  for (const el of Array.from(dom.window.document.querySelectorAll('[data-footnote-id]'))) {
    noteElements.set(el.getAttribute('data-footnote-id')!, el);
  }
  function directiveFailure(el: Element, message: string): void {
    diagnostics.add('LAYOUT_DIRECTIVE_INVALID', message, 'degradation', Number(el.getAttribute('data-source-line')) || undefined);
    const p = dom.window.document.createElement('p');
    p.textContent = el.getAttribute('data-word-directive');
    el.replaceWith(p);
  }
  for (const el of Array.from(dom.window.document.querySelectorAll('[data-word-directive]'))) {
    const text = el.getAttribute('data-word-directive')!;
    const next = el.nextElementSibling;
    let match: RegExpExecArray | null;
    if (el.closest('[data-footnotes]')) { directiveFailure(el, 'Layout directives inside footnotes are not supported; source retained.'); continue; }
    if ((match = /^<!-- word:document (.+) -->$/.exec(text)) && el === dom.window.document.body.firstElementChild) {
      try { options = parseDocumentOptions(match[1]); el.setAttribute('data-document-options', 'true'); }
      catch (error) { directiveFailure(el, (error as Error).message); }
    } else if ((match = /^<!-- word:section (landscape|portrait) -->$/.exec(text)) && el.parentElement === dom.window.document.body) {
      el.setAttribute('data-orientation', match[1]);
    } else if ((match = /^<!-- word:table widths=([0-9., ]+) -->$/.exec(text)) && next?.tagName === 'TABLE') {
      const ratios = match[1].split(',').map(Number);
      const count = next.querySelector('tr')?.children.length;
      if (ratios.length !== count || ratios.some(n => !Number.isFinite(n) || n <= 0 || n > 1000)) { directiveFailure(el, 'Table widths must be positive ratios matching the column count.'); continue; }
      next.setAttribute('data-widths', JSON.stringify(ratios)); el.remove();
    } else if ((match = /^<!-- word:list id=([A-Za-z][\w-]{0,63})(?: (continue|restart))? -->$/.exec(text)) && next?.tagName === 'OL') {
      next.setAttribute('data-list-id', match[1]); next.setAttribute('data-list-action', match[2] ?? 'restart'); el.remove();
    } else if ((match = /^<!-- word:numbering (source|section=[1-6]) -->$/.exec(text)) && el.parentElement === dom.window.document.body) {
      el.setAttribute('data-numbering-section', match[1] === 'source' ? '0' : match[1].slice(-1));
    } else if ((match = /^<!-- word:caption(?: kind=(figure|table) id=([A-Za-z][\w-]{0,63}))? -->$/.exec(text)) && next?.tagName === 'P') {
      if (match[1]) { next.setAttribute('data-caption-kind', match[1]); next.setAttribute('data-caption-id', match[2]); }
      next.setAttribute('data-caption', 'true'); el.remove();
    } else directiveFailure(el, 'Unknown or misplaced Word layout directive; source retained.');
  }
  const isFigure = (el: Element | null): boolean => !!el && (el.tagName === 'IMG' || el.tagName === 'TABLE' || el.tagName === 'P' && el.children.length === 1 && el.firstElementChild?.tagName === 'IMG');
  const captions = new Map<string, { bookmark: string; label: string; number: number; sequence: string }>();
  const captionCounts = { figure: 0, table: 0 };
  for (const caption of Array.from(dom.window.document.querySelectorAll('[data-caption]'))) {
    if (isFigure(caption.previousElementSibling)) caption.previousElementSibling!.setAttribute('data-keep-next', 'true');
    else if (isFigure(caption.nextElementSibling)) caption.setAttribute('data-keep-next', 'true');
    else diagnostics.add('LAYOUT_DIRECTIVE_INVALID', 'Caption has no adjacent image or table.');
    const kind = caption.getAttribute('data-caption-kind') as 'figure' | 'table' | null;
    const id = caption.getAttribute('data-caption-id');
    if (kind && id) {
      const target = isFigure(caption.previousElementSibling) ? caption.previousElementSibling : isFigure(caption.nextElementSibling) ? caption.nextElementSibling : null;
      if (!target || (target.tagName === 'TABLE') !== (kind === 'table') || captions.has(id)) {
        diagnostics.add('LAYOUT_DIRECTIVE_INVALID', 'Numbered caption needs a matching adjacent figure/table and unique id; caption text retained.');
        caption.removeAttribute('data-caption-id');
      } else captions.set(id, { bookmark: `caption_${captions.size + 1}`, label: kind === 'figure' ? '图' : '表', number: ++captionCounts[kind], sequence: kind === 'figure' ? 'Figure' : 'Table' });
    }
  }
  if (options.headingNumbering) numbering.push({ reference: 'document-headings', levels: Array.from({ length: 6 }, (_, level) => ({ level, format: 'decimal', text: Array.from({ length: level + 1 }, (_, i) => `%${i + 1}`).join('.'), start: 1, style: { paragraph: { indent: { left: 0, hanging: 0 } } } })) });
  const anchors = new Map<string, string>();
  const bookmarks = new Map<Element, string>();
  for (const heading of Array.from(dom.window.document.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    const base = headingSlug(heading.textContent ?? '') || 'section';
    let slug = base, suffix = 0;
    while (anchors.has(slug)) slug = `${base}-${++suffix}`;
    const name = `heading_${bookmarks.size + 1}`;
    anchors.set(slug, name);
    bookmarks.set(heading, name);
  }
  function textRuns(text: string, style: IRunOptions): TextRun[] {
    const pieces = text.split(/(\p{Emoji_Presentation}|\p{Extended_Pictographic}(?:\u{FE0F}|\u{200D}\p{Extended_Pictographic})*)/gu);
    return pieces.filter(Boolean).map(text => new TextRun({ ...(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(text) ? { font: 'Segoe UI Emoji' } : {}), ...style, text }));
  }
  function inline(nodes: Iterable<Node>, style: IRunOptions = {}, maxWidth = contentWidth() / 15): ParagraphChild[] {
    const runs: ParagraphChild[] = [];
    for (const node of nodes) {
      if (node.nodeType === 3) {
        // markdown-it adds a formatting newline after <br>; the run already
        // contains the hard break, so do not turn that newline into a space.
        const raw = node.previousSibling?.nodeName === 'BR'
          ? (node.textContent ?? '').replace(/^\r?\n/, '') : node.textContent ?? '';
        const collapsed = raw.replace(/[ \t\r\n\f]+/g, ' ');
        const text = collapsed;
        if (text) runs.push(...textRuns(text, style));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      const tag = el.tagName;
      if (el.hasAttribute('data-footnote-ref')) {
        const id = el.getAttribute('data-footnote-ref')!;
        if (!noteElements.has(id)) throw new Error('Missing footnote definition');
        if (referencedNotes.has(id)) {
          const field = new SimpleField(`NOTEREF note_${id} \\h \\f`);
          field.addChildElement(new TextRun({ text: String(noteNumbers.get(id)), style: 'FootnoteReference', superScript: true }));
          runs.push(field);
        }
        else {
          referencedNotes.add(id);
          noteNumbers.set(id, referencedNotes.size);
          runs.push(new Bookmark({ id: `note_${id}`, children: [new FootnoteReferenceRun(Number(id))] }));
        }
        continue;
      }
      if (el.hasAttribute('data-math')) {
        const formula = formulas.get(el.getAttribute('data-math')!);
        if (!formula) throw new Error('Missing converted formula');
        runs.push(...formula);
        continue;
      }
      if (tag === 'IMG') {
        const maxHeight = Math.min(MAX_IMAGE_HEIGHT, ((landscape ? PAGE_WIDTH : PAGE_HEIGHT) - mmToTwips(options.margins.top) - mmToTwips(options.margins.bottom)) / 15 - 80);
        onImageBounds?.(el.getAttribute('src') ?? '', { maxWidth: Math.min(560, maxWidth), maxHeight });
        const image = images.get(el.getAttribute('src') ?? '');
        if (image) {
          const width = Math.min(image.displayWidth ?? image.width, 560, maxWidth, maxHeight * image.width / image.height);
          runs.push(new ImageRun({ type: image.type, data: image.data, transformation: { width, height: Math.round(width * image.height / image.width) }, altText: { title: el.getAttribute('alt') ?? '', description: el.getAttribute('alt') ?? '', name: 'Image' } }));
        } else runs.push(new TextRun({ ...style, text: `[图片: ${el.getAttribute('alt') || '图片'}]`, italics: true, color: '6B7280' }));
      } else if (tag === 'BR') runs.push(new TextRun({ text: '', break: 1 }));
      else if (tag === 'CODE') runs.push(...textRuns(el.textContent ?? '', { ...style, font: 'Consolas', size: 22, color: 'DC2626' }));
      else if (tag === 'A') {
        const href = el.getAttribute('href') ?? '';
        const children = inline(el.childNodes, { ...style, color: '2563EB', underline: {} }, maxWidth);
        if (href.startsWith('#ref:')) {
          const target = captions.get(href.slice(5));
          if (target) {
            const field = new SimpleField(`REF ${target.bookmark} \\h`);
            field.addChildElement(new TextRun({ ...style, text: `${target.label} ${target.number}` }));
            runs.push(field);
          } else { runs.push(...children); diagnostics.add('LINK_UNAVAILABLE', 'Cross-reference has no matching numbered caption; link text retained.'); }
        } else if (href.startsWith('#')) {
          let target: string | undefined;
          try { target = anchors.get(decodeURIComponent(href.slice(1))); } catch { /* Invalid fragment. */ }
          if (target) runs.push(new InternalHyperlink({ anchor: target, children }));
          else {
            runs.push(...children);
            diagnostics.add('LINK_UNAVAILABLE', 'Internal link has no matching heading; link text retained.');
          }
        } else if (href) runs.push(new ExternalHyperlink({ link: href, children }));
        else runs.push(...children);
      } else runs.push(...inline(el.childNodes, { ...style, ...(['STRONG', 'B'].includes(tag) ? { bold: true } : {}), ...(['EM', 'I'].includes(tag) ? { italics: true } : {}), ...(['DEL', 'S'].includes(tag) ? { strike: true } : {}) }, maxWidth));
    }
    return runs;
  }
  function list(el: Element, level: number, layout: Layout): Block[] {
    const safeLevel = Math.min(level, 4);
    if (level > 4) diagnostics.add('LIST_DEPTH_REDUCED', 'List nesting deeper than five levels was flattened.');
    const ordered = el.tagName === 'OL';
    let reference = `list-${nextList++}`;
    const textLeft = Math.min(layout.left + (level > 4 ? 0 : 720), contentWidth() - layout.right - 720);
    const hanging = ordered ? 480 : 360;
    const itemLayout = { ...layout, left: textLeft };
    const start = Number(el.getAttribute('start') ?? 1);
    const id = el.getAttribute('data-list-id');
    const key = `${sectionLevel ? section : 'document'}:${id}`;
    const prior = id ? namedLists.get(key) : undefined;
    const explicitStart = el.hasAttribute('start');
    if (ordered && id && el.getAttribute('data-list-action') === 'continue') {
      if (prior && prior.level === safeLevel && prior.left === textLeft && !explicitStart) reference = prior.reference;
      else diagnostics.add('LIST_CONTINUATION_UNAVAILABLE', 'List continuation needs a preceding matching list in scope, the same indentation, and no explicit non-default start.');
    } else if (ordered && !id && sectionLevel && level === 0 && !layout.quote && el.parentElement === dom.window.document.body && !explicitStart && autoList) reference = autoList;
    if (ordered && id) namedLists.set(key, { reference, level: safeLevel, left: textLeft });
    if (ordered && !id && sectionLevel && level === 0 && !layout.quote && el.parentElement === dom.window.document.body) autoList = reference;
    if (!numbering.some(config => config.reference === reference)) numbering.push({ reference, levels: numberingLevels(ordered, Number.isSafeInteger(start) && start >= 0 ? start : 1).map(item => ({
      ...item, style: { ...item.style, paragraph: { ...item.style?.paragraph,
        indent: { left: textLeft, hanging }, tabStops: [{ type: 'left', position: textLeft }],
      } },
    })) });
    const result: Block[] = [];
    for (const li of Array.from(el.children).filter(child => child.tagName === 'LI')) {
      let numbered = false;
      let pending: Node[] = [];
      const flush = (force = false): void => {
        if (!pending.length && !force) return;
        result.push(new Paragraph({ children: inline(pending, {}, availablePixels(itemLayout)),
          ...(layout.quote ? { style: 'Quote' } : {}),
          ...(!numbered ? { numbering: { reference, level: safeLevel }, indent: { left: textLeft, hanging, right: layout.right } }
            : { indent: { firstLine: 0, hanging: 0, left: textLeft, right: layout.right } }),
        }));
        numbered = true;
        pending = [];
      };
      for (const child of li.childNodes) {
        // Keep soft breaks between inline siblings, but discard list HTML layout whitespace.
        if (child.nodeType === 3 && !(child.textContent ?? '').trim()
          && (!pending.length || !child.nextSibling || /^(UL|OL|P|PRE|TABLE|BLOCKQUOTE|HR|H[1-6])$/.test(child.nextSibling.nodeName))) continue;
        const tag = child.nodeName;
        if (tag === 'UL' || tag === 'OL') { flush(!numbered); result.push(...list(child as Element, level + 1, itemLayout)); }
        else if (tag === 'P' && ((child as Element).hasAttribute('data-math-block') || (child as Element).hasAttribute('data-caption'))) { flush(!numbered); result.push(...block(child, level, itemLayout)); }
        else if (tag === 'P') { flush(); pending.push(...child.childNodes); flush(!numbered); }
        else if (['PRE', 'TABLE', 'BLOCKQUOTE', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) { flush(!numbered); result.push(...block(child, level, itemLayout)); }
        else pending.push(child);
      }
      flush(!numbered);
    }
    return result;
  }
  function block(node: Node, level = 0, layout: Layout = rootLayout, quoteAfter?: number): Block[] {
    if (node.nodeType === 3) return (node.textContent ?? '').trim() ? [new Paragraph({ children: inline([node], {}, availablePixels(layout)), indent: { left: layout.left, right: layout.right } })] : [];
    if (node.nodeType !== 1) return [];
    const el = node as Element;
    const tag = el.tagName;
    if (el.hasAttribute('data-document-options') || el.hasAttribute('data-orientation')) return [];
    if (el.hasAttribute('data-footnotes')) return [];
    if (el.hasAttribute('data-numbering-section')) { sectionLevel = Number(el.getAttribute('data-numbering-section')); section++; autoList = undefined; return []; }
    if (/^H[1-6]$/.test(tag) && el.parentElement === dom.window.document.body && sectionLevel && Number(tag[1]) <= sectionLevel) { section++; autoList = undefined; }
    const width = availablePixels(layout);
    const indent = { left: layout.left, right: layout.right, firstLine: 0 };
    if (/^H[1-6]$/.test(tag)) return [new Paragraph({ children: [new Bookmark({ id: bookmarks.get(el)!, children: inline(el.childNodes, {}, width) })], ...(options.headingNumbering && el.parentElement === dom.window.document.body ? { numbering: { reference: 'document-headings', level: Number(tag[1]) - 1 } } : {}), indent, keepNext: true, keepLines: true, heading: HeadingLevel[`HEADING_${tag[1]}` as keyof typeof HeadingLevel] })];
    if (tag === 'P' && el.hasAttribute('data-math-block')) return [new Paragraph({ children: inline(el.childNodes, {}, width), alignment: AlignmentType.CENTER, indent, spacing: { before: 160, after: 160 } })];
    if (tag === 'P' && el.hasAttribute('data-mermaid-notice')) return [new Paragraph({ children: [new TextRun({ text: el.textContent ?? '', color: '92400E', size: 20 })], indent, spacing: { before: 160, after: 80 }, keepNext: true })];
    if (tag === 'P') {
      const meaningful = Array.from(el.childNodes).filter(child => child.nodeType !== 3 || child.textContent?.trim());
      if (meaningful.length === 1 && meaningful[0].nodeName === 'IMG') {
        if (el.hasAttribute('data-keep-next')) (meaningful[0] as Element).setAttribute('data-keep-next', 'true');
        return block(meaningful[0], level, layout);
      }
      if (el.hasAttribute('data-caption')) {
        const target = captions.get(el.getAttribute('data-caption-id') ?? '');
        const prefix: ParagraphChild[] = [];
        if (target) {
          const field = new SimpleField(`SEQ ${target.sequence} \\* ARABIC`, String(target.number));
          prefix.push(new Bookmark({ id: target.bookmark, children: [new TextRun(`${target.label} `), field] }), new TextRun('：'));
        }
        return [new Paragraph({ style: 'Caption', children: [...prefix, ...inline(el.childNodes, {}, width)], indent, keepNext: el.hasAttribute('data-keep-next'), keepLines: true })];
      }
      return [new Paragraph({ children: inline(el.childNodes, {}, width), widowControl: true, style: layout.quote ? 'Quote' : 'BodyText',
        ...(layout.quote || layout.left || layout.right ? { indent } : {}),
        ...(layout.quote && quoteAfter !== undefined ? { spacing: { after: quoteAfter } } : {}),
      })];
    }
    if (tag === 'PRE') {
      const lines = (el.textContent ?? '').split('\n');
      return [new Paragraph({ style: 'CodeBlock', keepLines: estimatedLines(el.textContent ?? '', width * 15 - 480) <= 12, widowControl: true, indent: { ...indent, left: layout.left + 240, right: layout.right + 240 }, children: lines.flatMap((text, index) => [...(index ? [new TextRun({ text: '', break: 1 })] : []), new TextRun({ text: text || ' ', font: 'Consolas', size: 22, color: '1F2937' })]) })];
    }
    if (tag === 'HR') return [new Paragraph({ indent, spacing: { before: 200, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, color: '9CA3AF', size: 12, space: 1 } } })];
    if (tag === 'UL' || tag === 'OL') return list(el, level, layout);
    if (tag === 'TABLE') {
      const trs = Array.from(el.querySelectorAll('tr'));
      const count = Math.max(1, ...trs.map(tr => tr.children.length));
      const tableWidth = Math.max(1, contentWidth() - layout.left - layout.right);
      const ratios = el.hasAttribute('data-widths') ? JSON.parse(el.getAttribute('data-widths')!) as number[] : undefined;
      let widths = columnWidths(trs, count, tableWidth, ratios);
      if (ratios && widths.some(width => width < 480)) {
        diagnostics.add('LAYOUT_DIRECTIVE_INVALID', 'Explicit column widths leave less than 480 twips for a cell; automatic widths used.');
        widths = columnWidths(trs, count, tableWidth);
      }
      const outer = { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF' };
      const inner = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
      return [new Table({ layout: TableLayoutType.FIXED, indent: { size: layout.left, type: WidthType.DXA }, width: { size: tableWidth, type: WidthType.DXA }, columnWidths: widths, borders: { top: outer, bottom: outer, left: outer, right: outer, insideHorizontal: inner, insideVertical: inner }, rows: trs.map(tr => {
        const header = tr.parentElement?.tagName === 'THEAD';
        return new TableRow({ cantSplit: Array.from(tr.children).every((cell, i) => !cell.querySelector('img,[data-math]') && estimatedLines(cell.textContent ?? '', (widths[i] - 300) * 12 / options.fontSize) <= 8), tableHeader: header || undefined, children: Array.from(tr.children).map((cell, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, ...(header ? { shading: { fill: 'E5E7EB' } } : {}), verticalAlign: VerticalAlign.CENTER, margins: { top: header ? 120 : 100, bottom: header ? 120 : 100, left: 150, right: 150 }, children: [new Paragraph({ keepNext: el.hasAttribute('data-keep-next') && tr === trs[trs.length - 1], indent: { firstLine: 0 }, alignment: ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as Record<string, typeof AlignmentType.LEFT | typeof AlignmentType.CENTER | typeof AlignmentType.RIGHT>)[(cell as HTMLElement).style.textAlign] ?? (header || cell.tagName === 'TH' ? AlignmentType.CENTER : AlignmentType.LEFT), children: inline(cell.childNodes, header ? { bold: true, size: options.fontSize * 2 } : {}, Math.max(1, (widths[i] - 300) / 15)) })] })) });
      }) })];
    }
    if (tag === 'IMG') return [new Paragraph({ keepNext: el.hasAttribute('data-keep-next'), children: inline([el], {}, width), alignment: images.has(el.getAttribute('src') ?? '') ? AlignmentType.CENTER : undefined, indent, spacing: { before: 200, after: 200 } })];
    if (tag === 'BLOCKQUOTE') {
      const children = Array.from(el.childNodes).filter(child => child.nodeType !== 3 || child.textContent?.trim());
      return children.flatMap((child, index) => block(child, level, { ...layout, left: layout.left + charsToTwips(2), quote: true }, index === children.length - 1 ? undefined : 0));
    }
    return Array.from(el.childNodes).flatMap(child => block(child, level, layout));
  }
  try {
    const sections: { landscape: boolean; children: Block[] }[] = [{ landscape: false, children: [] }];
    let children = sections[0].children;
    // Walk siblings rather than body.childNodes: a live body-level NodeList makes
    // jsdom's window.close() teardown quadratic in the number of top-level blocks.
    for (let node = dom.window.document.body.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 1 && (node as Element).hasAttribute('data-orientation')) {
        const next = (node as Element).getAttribute('data-orientation') === 'landscape';
        if (next !== landscape) {
          landscape = next;
          if (children.length) { children = []; sections.push({ landscape, children }); }
          else sections.at(-1)!.landscape = landscape;
        }
        continue;
      }
      for (const item of block(node)) {
        // Word can merge adjacent tables even when separate table XML is emitted.
        if (item instanceof Table && children.at(-1) instanceof Table) children.push(new Paragraph({ spacing: { before: 0, after: 80, line: 20 }, children: [new TextRun({ text: '', size: 2 })] }));
        children.push(item);
      }
    }
    // Footnotes may occur in any section; use the narrower page for image bounds.
    landscape = false;
    for (const [id, note] of noteElements) {
      const paragraphs: Paragraph[] = [];
      const noteBlocks = (el: Element): void => {
        if (el.tagName === 'TABLE') {
          diagnostics.add('FOOTNOTE_TABLE_FLATTENED', 'Footnote table cells retained as separate paragraphs.');
          for (const cell of Array.from(el.querySelectorAll('th,td'))) paragraphs.push(new Paragraph({ style: 'FootnoteText', children: inline(cell.childNodes) }));
        } else if (el.tagName === 'P' && !el.hasAttribute('data-math-block')) {
          paragraphs.push(new Paragraph({ style: 'FootnoteText', children: inline(el.childNodes), indent: { firstLine: 0 }, widowControl: true }));
        } else if (el.querySelector('table')) {
          for (const child of Array.from(el.children)) noteBlocks(child);
        } else {
          for (const converted of block(el)) {
            if (converted instanceof Paragraph) paragraphs.push(converted);
          }
        }
      };
      for (const child of Array.from(note.children)) noteBlocks(child);
      if (paragraphs.length) paragraphs[0].addRunToFront(new TextRun(' '));
      if (referencedNotes.has(id)) footnotes[id] = { children: paragraphs.length ? paragraphs : [new Paragraph('')] };
      else {
        diagnostics.add('FOOTNOTE_UNUSED', 'Footnote without a body reference retained as body text.', 'info');
        children.push(...paragraphs);
      }
    }
    if (!children.length && sections.length > 1) sections.pop();
    if (!sections[0].children.length) sections[0].children.push(new Paragraph(''));
    return { children: sections.flatMap(section => section.children), sections, options, numbering: { config: numbering }, footnotes };
  } finally { dom.window.close(); }
}
