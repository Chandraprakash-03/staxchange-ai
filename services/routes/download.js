const express = require('express');
const JSZip = require('jszip');
const router = express.Router();

// Create ZIP from files
router.post('/', async (req, res) => {
  try {
    const { files } = req.body;
    
    if (!Array.isArray(files)) {
      return res.status(400).json({ error: "No files provided" });
    }

    if (files.length === 0) {
      return res.status(400).json({ error: "Files array is empty" });
    }

    console.log(`Creating ZIP with ${files.length} files`);

    const zip = new JSZip();

    // Add files to ZIP
    for (const f of files) {
      if (!f || typeof f !== 'object') {
        console.warn('Skipping invalid file object:', f);
        continue;
      }

      const path = (f.path || "file.txt").replace(/^\/+/, "");
      const content = f.content || "";
      
      // Create directory structure if needed
      if (path.includes('/')) {
        const dirs = path.split('/');
        dirs.pop(); // Remove filename
        let currentDir = zip;
        
        for (const dir of dirs) {
          if (dir) {
            currentDir = currentDir.folder(dir);
          }
        }
      }
      
      zip.file(path, content);
    }

    console.log('Generating ZIP file...');

    // Generate ZIP as buffer
    const zipBuffer = await zip.generateAsync({ 
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: {
        level: 6
      }
    });

    console.log(`ZIP generated successfully, size: ${zipBuffer.length} bytes`);

    // Set appropriate headers for file download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.zip"');
    res.setHeader('Content-Length', zipBuffer.length);
    
    // Send the ZIP file
    res.send(zipBuffer);

  } catch (error) {
    console.error('ZIP creation error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create ZIP file',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
