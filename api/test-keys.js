// api/test-keys.js — verifies API keys are working
async function handler(req, res) {
  const aaiKey = process.env.ASSEMBLYAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  const results = { assemblyai: 'not tested', groq: 'not tested' };

  // Test AssemblyAI
  if (!aaiKey) {
    results.assemblyai = 'MISSING — not in .env.local';
  } else {
    try {
      const r = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'GET',
        headers: { 'authorization': aaiKey }
      });
      results.assemblyai = r.status === 200 || r.status === 400
        ? 'OK (key valid)' : 'ERROR — HTTP ' + r.status;
    } catch(e) {
      results.assemblyai = 'FETCH FAILED: ' + e.message;
    }
  }

  // Test Groq
  if (!groqKey) {
    results.groq = 'MISSING — not in .env.local';
  } else {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'authorization': 'Bearer ' + groqKey }
      });
      results.groq = r.status === 200 ? 'OK (key valid)' : 'ERROR — HTTP ' + r.status;
    } catch(e) {
      results.groq = 'FETCH FAILED: ' + e.message;
    }
  }

  return res.status(200).json(results);
};


export default handler;
if (typeof module !== "undefined") module.exports = handler;
