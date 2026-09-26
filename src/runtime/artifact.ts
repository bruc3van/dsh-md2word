import path from 'node:path';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { ExportError } from './errors.js';
/** Well-formed (namespace-aware) XML check; returns each Relationship's attributes. */
function parseXml(xml: string): Record<string, string>[] {
  const relationships: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true, position: false });
  parser.on('error', error => { throw error; });
  parser.on('opentag', tag => {
    if (tag.name === 'Relationship') relationships.push(Object.fromEntries(Object.entries(tag.attributes).map(([name, attr]) => [name, attr.value])));
  });
  parser.write(xml).close();
  return relationships;
}
/** Validate generated OPC parts, XML and all internal relationships before saving. */
export async function validateArtifact(data: Uint8Array, maxBytes: number): Promise<void> {
  if (data.byteLength > maxBytes) throw new ExportError('DOCX exceeds the output limit.', 'LIMIT_EXCEEDED');
  try {
    const zip = await JSZip.loadAsync(data, { checkCRC32: true });
    for (const file of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels']) if (!zip.file(file)) throw new Error('Missing DOCX part');
    const relationships = new Map<string, Set<string>>();
    const documents = new Map<string, string>();
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !/\.(xml|rels)$/.test(entry.name)) continue;
      const xml = await entry.async('string');
      const rels = parseXml(xml);
      if (entry.name.endsWith('.rels')) {
        const base = entry.name === '_rels/.rels' ? '' : path.posix.dirname(path.posix.dirname(entry.name));
        const owner = entry.name === '_rels/.rels' ? '' : path.posix.join(base, path.posix.basename(entry.name, '.rels'));
        const ids = new Set<string>();
        for (const rel of rels) {
          const id = rel.Id; const target = rel.Target;
          if (!id || !target || ids.has(id)) throw new Error('Invalid relationship');
          ids.add(id);
          if (rel.TargetMode !== 'External') {
            const resolved = path.posix.normalize(path.posix.join(base, target));
            if (resolved.startsWith('../') || !zip.file(resolved)) throw new Error('Missing relationship target');
          }
        }
        relationships.set(owner, ids);
      } else documents.set(entry.name, xml);
    }
    for (const [name, xml] of documents) for (const match of xml.matchAll(/\br:(?:embed|id|link)="([^"]+)"/g)) if (!relationships.get(name)?.has(match[1])) throw new Error('Missing relationship identifier');
  } catch (cause) { throw new ExportError('Generated DOCX failed integrity validation.', 'CONVERSION_FAILED', { cause }); }
}
