import JSZip from 'jszip';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const xmlText = xml => [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(m => m[1].replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0] === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')).join('\n');

export async function parseDocument(name, buffer) {
  const ext = name.split('.').pop().toLowerCase();
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('文件应为 1 字节至 20 MB。');
  if (['txt', 'md'].includes(ext)) return { type: 'text', mime: 'text/plain; charset=utf-8', pages: [{ number: 1, text: buffer.toString('utf8').slice(0, 500000) }] };
  if (ext === 'pdf') {
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('PDF 文件格式无效。');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 300) throw new Error('首版支持最多 300 页 PDF，请拆分文件。');
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push({ number: i, text: content.items.map(t => t.str + (t.hasEOL ? '\n' : ' ')).join('').slice(0, 50000) });
        page.cleanup();
      }
      return { type: 'pdf', mime: 'application/pdf', pages, warning: pages.every(p => !p.text.trim()) ? '扫描件没有文本层，请在页面上圈选后使用图像识别。' : '' };
    } finally { await task.destroy(); }
  }
  if (ext === 'pptx') {
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
    if (!slides.length || slides.length > 300) throw new Error('PPTX 应包含 1–300 张幻灯片。');
    let expanded = 0;
    const pages = [];
    for (const [i, name] of slides.entries()) {
      const entry = zip.file(name);
      // Check advertised sizes before decompression; never execute embedded macros or objects.
      expanded += entry._data?.uncompressedSize || 0;
      if (expanded > 30 * 1024 * 1024) throw new Error('PPTX 文本解压后过大。');
      const xml = await entry.async('string');
      if (xml.length > 5 * 1024 * 1024) throw new Error('幻灯片文本过大。');
      pages.push({ number: i + 1, text: xmlText(xml).slice(0, 50000) });
    }
    return { type: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pages, warning: 'PPTX 当前提取逐页文字；公式对象、图表和原始排版请导出 PDF 或图片导入。' };
  }
  const signatures = {
    png: ['image/png', b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))],
    jpg: ['image/jpeg', b => b[0] === 255 && b[1] === 216 && b[2] === 255],
    jpeg: ['image/jpeg', b => b[0] === 255 && b[1] === 216 && b[2] === 255],
    webp: ['image/webp', b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
  };
  if (signatures[ext]?.[1](buffer)) return { type: 'image', mime: signatures[ext][0], pages: [{ number: 1, text: '' }], warning: '图片可直接圈选；识别、翻译和解释需要配置视觉模型。' };
  throw new Error('支持 PDF、PPTX、PNG、JPEG、WebP、TXT 和 Markdown；旧版 PPT 请先另存为 PPTX。');
}
