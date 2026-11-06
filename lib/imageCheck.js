// Detects the real image type from the file's first bytes, so a renamed file
// (or an SVG/HTML file with an image/* label) cannot be uploaded as an image.
function detectImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  const head = buf.slice(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return { ext: '.gif', mime: 'image/gif' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  return null;
}

const badImage = () => Object.assign(new Error('Unsupported image. Please upload a JPG, PNG, GIF or WebP file.'), { status: 400 });

module.exports = { detectImage, badImage };
