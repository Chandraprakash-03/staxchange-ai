const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// GitHub OAuth start
router.get('/github', (req, res) => {
  try {
    const clientId = process.env.GITHUB_CLIENT_ID;
    
    if (!clientId) {
      return res.status(500).json({ error: "Missing GITHUB_CLIENT_ID environment variable" });
    }

    const returnTo = req.query.return_to || '';
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/github/callback`;
    
    const state = Buffer.from(JSON.stringify({ return_to: returnTo })).toString('base64');
    
    const ghUrl = new URL("https://github.com/login/oauth/authorize");
    ghUrl.searchParams.set("client_id", clientId);
    ghUrl.searchParams.set("redirect_uri", redirectUri);
    ghUrl.searchParams.set("scope", "repo");
    ghUrl.searchParams.set("state", state);

    console.log('GitHub auth start:', { 
      redirectUri, 
      ghUrl: ghUrl.toString() 
    });

    res.redirect(ghUrl.toString());
    
  } catch (error) {
    console.error('GitHub auth start error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GitHub OAuth callback
router.get('/github/callback', async (req, res) => {
  try {
    const { code, state: stateRaw } = req.query;
    
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    const state = JSON.parse(Buffer.from(stateRaw || "e30=", 'base64').toString());
    
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "Missing GitHub OAuth credentials" });
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/github/callback`;

    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        Accept: "application/json" 
      },
      body: JSON.stringify({ 
        client_id: clientId, 
        client_secret: clientSecret, 
        code, 
        redirect_uri: redirectUri 
      }),
    });

    const tokenJson = await tokenResp.json();
    
    if (!tokenResp.ok || tokenJson.error) {
      throw new Error(tokenJson.error_description || "Failed to exchange authorization code");
    }

    const returnTo = state?.return_to || "/";
    const redirect = `${returnTo}#github_token=${encodeURIComponent(tokenJson.access_token)}`;

    console.log('GitHub OAuth callback success:', { returnTo, redirect });

    res.redirect(redirect);
    
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
