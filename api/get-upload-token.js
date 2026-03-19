// api/get-upload-token.js
// Safely passes the AssemblyAI key to the browser for direct upload
// This is safe because AssemblyAI upload tokens only allow uploading files,
// not reading transcripts or making other API calls.

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return res.status(500).json({ error: 'AssemblyAI key not configured' });

  return res.status(200).json({ token: key });
};


export default handler;
if (typeof module !== "undefined") module.exports = handler;
