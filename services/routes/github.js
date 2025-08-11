const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

async function gh(token, path) {
  const resp = await fetch(`https://api.github.com${path}`, {
    headers: { 
      Authorization: `Bearer ${token}`, 
      Accept: "application/vnd.github+json",
      'User-Agent': 'StaxChange-NodeJS-Server'
    },
  });
  
  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`GitHub API error ${resp.status}: ${errorText}`);
  }
  
  return resp.json();
}

// Get repositories and branches
router.post('/', async (req, res) => {
  try {
    const { token, action, owner, repo } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    if (action === "branches") {
      if (!owner || !repo) {
        return res.status(400).json({ error: "Missing owner or repo for branches action" });
      }
      
      const branches = await gh(token, `/repos/${owner}/${repo}/branches?per_page=100`);
      const repoInfo = await gh(token, `/repos/${owner}/${repo}`);
      
      return res.json({ 
        branches, 
        default: repoInfo.default_branch 
      });
    }

    // Default action: get repositories
    const repos = await gh(token, "/user/repos?per_page=100&sort=updated");
    res.json({ repos });
    
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
