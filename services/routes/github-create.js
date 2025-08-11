const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

async function gh(token, path, init = {}) {
  const resp = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      'User-Agent': 'StaxChange-NodeJS-Server',
      ...(init.headers || {}),
    },
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`GitHub API error ${resp.status}: ${errorText}`);
  }

  return resp.json();
}

// Create new repository with files
router.post('/', async (req, res) => {
  try {
    const { token, repoName, files, description, isPrivate } = req.body;

    if (!token || !repoName || !files) {
      return res.status(400).json({ 
        error: "Missing required fields: token, repoName, files" 
      });
    }

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ 
        error: "Files must be a non-empty array" 
      });
    }

    console.log(`Creating repository: ${repoName} with ${files.length} files`);

    // Create the repository
    const repoData = {
      name: repoName,
      private: isPrivate || false,
      auto_init: true,
      description: description || `Converted repository via StaxChange - ${new Date().toISOString()}`
    };

    const created = await gh(token, "/user/repos", {
      method: "POST",
      body: JSON.stringify(repoData),
    });

    console.log(`Repository created: ${created.html_url}`);

    // Wait a moment for repository initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Upload files to the repository
    const uploadResults = [];
    const batchSize = 5; // Process files in batches to avoid rate limits

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (f, index) => {
        try {
          if (!f || !f.path || f.content === undefined) {
            console.warn(`Skipping invalid file at index ${i + index}:`, f);
            return { success: false, path: f?.path || 'unknown', error: 'Invalid file object' };
          }

          const path = f.path.replace(/^\/+/, "");
          
          if (!path) {
            console.warn(`Skipping file with empty path at index ${i + index}`);
            return { success: false, path: 'empty', error: 'Empty file path' };
          }

          // Encode content to base64
          const content = Buffer.from(f.content, 'utf8').toString('base64');
          
          const commitMessage = `Add ${path}`;
          
          await gh(token, `/repos/${created.owner.login}/${created.name}/contents/${encodeURIComponent(path)}`, {
            method: "PUT",
            body: JSON.stringify({ 
              message: commitMessage, 
              content,
              committer: {
                name: "StaxChange",
                email: "bot@staxchange.ai"
              }
            }),
          });

          console.log(`Uploaded file: ${path}`);
          return { success: true, path };

        } catch (fileError) {
          console.error(`Error uploading file ${f?.path}:`, fileError.message);
          return { 
            success: false, 
            path: f?.path || 'unknown', 
            error: fileError.message 
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      uploadResults.push(...batchResults);

      // Small delay between batches
      if (i + batchSize < files.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`Completed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(files.length / batchSize)}`);
    }

    const successfulUploads = uploadResults.filter(r => r.success);
    const failedUploads = uploadResults.filter(r => !r.success);

    console.log(`Upload completed: ${successfulUploads.length} successful, ${failedUploads.length} failed`);

    res.json({
      html_url: created.html_url,
      clone_url: created.clone_url,
      repository: {
        name: created.name,
        full_name: created.full_name,
        owner: created.owner.login,
        private: created.private
      },
      upload_stats: {
        total: files.length,
        successful: successfulUploads.length,
        failed: failedUploads.length,
        failed_files: failedUploads.map(f => ({ path: f.path, error: f.error }))
      }
    });

  } catch (error) {
    console.error('Repository creation error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create repository',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
