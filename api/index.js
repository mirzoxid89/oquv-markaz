// Vercel serverless funksiyasi: barcha /api/* so'rovlari shu yerga yo'naltiriladi (vercel.json).
// Mantiq server.js da — lokal server bilan bir xil kod.
module.exports = require('../server.js').handler;
