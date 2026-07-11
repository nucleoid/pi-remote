export const REMOTE_CONTROL_MAX_PAYLOAD = 32 * 1024 * 1024;
const MAX_BINARY_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 200 * 1024;
const MAX_ATTACHMENTS = 4;
function cleanName(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new Error('Attachment name is required'); return value.trim().replace(/[\r\n]/g, ' ').slice(0, 240); }
function cleanMime(value: unknown, fallback = 'application/octet-stream'): string { if (typeof value !== 'string' || !value.trim()) return fallback; const mime = value.trim().toLowerCase(); if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) throw new Error('Invalid attachment MIME type'); return mime; }
function decode(name: string, data: unknown): Buffer {
  if (typeof data !== 'string' || !data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4) throw new Error(`Invalid base64 attachment: ${name}`);
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if ((data.length / 4) * 3 - padding > MAX_BINARY_ATTACHMENT_BYTES) throw new Error(`Attachment ${name} exceeds 5MB`);
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) throw new Error(`Invalid base64 attachment: ${name}`);
  return bytes;
}
function imageMatches(mime: string, bytes: Buffer): boolean {
  if (mime === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mime === 'image/jpeg' || mime === 'image/jpg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/gif') return /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}
export function buildUserContent(text: string, images: any[] = [], files: any[] = []) {
  if (images.length + files.length > MAX_ATTACHMENTS) throw new Error(`At most ${MAX_ATTACHMENTS} attachments are supported`);
  const content: any[] = [];
  if (text) content.push({ type: 'text', text });
  for (const file of files) {
    const name = cleanName(file.name), mime = cleanMime(file.mimeType, file.encoding === 'base64' ? 'application/octet-stream' : 'text/plain');
    if (file.encoding === 'base64' || file.data) {
      if (file.encoding !== 'base64') throw new Error(`Binary attachment ${name} must declare encoding: base64`);
      const bytes = decode(name, file.data);
      content.push({ type: 'text', text: `Attached binary file: ${name} (${mime}, ${bytes.length} B). The file was received as an attachment; binary bytes are intentionally not inlined.` });
    } else if (typeof file.text === 'string') {
      if (Buffer.byteLength(file.text) > MAX_TEXT_ATTACHMENT_BYTES) throw new Error(`Text attachment ${name} exceeds 200KB`);
      content.push({ type: 'text', text: `Attached file: ${name} (${mime})\n\n\`\`\`\n${file.text}\n\`\`\`` });
    }
  }
  for (const image of images) {
    const name = cleanName(image.name ?? 'image'), mime = cleanMime(image.mimeType), bytes = decode(name, image.data);
    if (!mime.startsWith('image/') || !imageMatches(mime, bytes)) throw new Error(`Invalid image attachment: ${name}`);
    content.push({ type: 'image', data: bytes.toString('base64'), mimeType: mime });
  }
  return content.length === 1 && content[0].type === 'text' ? content[0].text : content;
}
