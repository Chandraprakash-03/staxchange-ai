const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

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

function isCodeFile(path) {
  return /\.(ts|tsx|js|jsx|py|cs|java|go|rs|php|rb|kt|scala|sql|sh|yml|yaml|json|html|css|scss|less)$/i.test(path);
}

async function fetchFiles(token, owner, repo, branch) {
  console.log(`Fetching files for ${owner}/${repo}:${branch}`);
  
  const branchInfo = await gh(token, `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  const sha = branchInfo?.commit?.sha;
  
  if (!sha) {
    throw new Error(`Could not find SHA for branch ${branch}`);
  }
  
  const tree = await gh(token, `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const files = (tree.tree || [])
    .filter((n) => n.type === "blob" && isCodeFile(n.path))
    .slice(0, 50); // Reduced limit for better processing
  
  console.log(`Found ${files.length} code files to process`);
  
  const results = [];
  const batchSize = 5; // Smaller batches for better reliability
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchPromises = batch.map(async (f) => {
      try {
        const contentResp = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}?ref=${encodeURIComponent(branch)}`);
        const decoded = Buffer.from(contentResp.content, 'base64').toString('utf-8');
        return { path: f.path, content: decoded };
      } catch (error) {
        console.error(`Error fetching ${f.path}:`, error.message);
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(Boolean));
    
    // Small delay between batches to respect rate limits
    if (i + batchSize < files.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  console.log(`Successfully fetched ${results.length} files`);
  return results;
}

async function convertBatch(batch, target) {
  if (!OPENROUTER_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable");
  }

  // Enhanced system prompt with clearer instructions
  const sys = `You are a senior software engineer specializing in cross-platform code conversion. 

TASK: Convert the provided source code files to the specified target technology stack.

TARGET STACK:
- Language: ${target.language}
- Framework: ${target.framework} 
- Database: ${target.database}

CONVERSION RULES:
1. Convert ALL code to the target language (${target.language})
2. Use the target framework (${target.framework}) patterns and conventions
3. Adapt database queries/models for ${target.database}
4. Preserve the original functionality and business logic
5. Update file extensions to match the target language
6. Follow the target language's naming conventions and best practices
7. Include necessary imports/dependencies for the target stack

CRITICAL: You MUST return ONLY a valid JSON object with this exact structure:
{
  "files": [
    {
      "path": "converted/file/path.ext",
      "content": "converted code content here"
    }
  ]
}

Do not include any explanations, markdown formatting, or text outside the JSON object.`;

  // Create file content for the AI to process
  const fileContents = batch.map((file, index) => 
    `=== FILE ${index + 1}: ${file.path} ===\n${file.content}\n`
  ).join('\n\n');

  const userMessage = `Convert these ${batch.length} files to ${target.language} with ${target.framework} framework and ${target.database} database:\n\n${fileContents}`;

  console.log(`Converting batch of ${batch.length} files to ${target.language}/${target.framework}`);

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://staxchange.ai",
        "X-Title": "StaxChange AI Converter",
      },
      body: JSON.stringify({
        model: "z-ai/glm-4.5-air:free",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMessage }
        ],
        // temperature: 0.1, // Lower temperature for more consistent output
        // max_tokens: 8000,  // Increased token limit
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`OpenRouter API error ${resp.status}:`, errorText);
      throw new Error(`OpenRouter API error ${resp.status}: ${errorText}`);
    }

    const data = await resp.json();
    const aiResponse = data?.choices?.[0]?.message?.content || "";
    
    console.log('AI Response preview:', aiResponse.substring(0, 200) + '...');
    
    // Try to extract JSON from the response
    let parsed;
    try {
      // First try to parse the entire response as JSON
      parsed = JSON.parse(aiResponse);
    } catch (e) {
      // If that fails, try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          console.error('Failed to parse extracted JSON:', e2);
          throw new Error('AI returned invalid JSON format');
        }
      } else {
        console.error('No JSON found in AI response');
        throw new Error('AI did not return JSON format');
      }
    }
    
    // Validate the response structure
    if (!parsed || !Array.isArray(parsed.files)) {
      console.error('Invalid response structure:', parsed);
      throw new Error('AI returned invalid response structure');
    }
    
    // Validate each file in the response
    const validFiles = parsed.files.filter(file => {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
        console.warn('Skipping invalid file entry:', file);
        return false;
      }
      return true;
    });
    
    if (validFiles.length === 0) {
      throw new Error('No valid converted files in AI response');
    }
    
    console.log(`Successfully converted ${validFiles.length} files`);
    return validFiles;
    
  } catch (error) {
    console.error('Conversion error:', error.message);
    // Instead of returning originals, throw the error to be handled upstream
    throw new Error(`Failed to convert files: ${error.message}`);
  }
}

// Convert repository endpoint
router.post('/', async (req, res) => {
  try {
    const { token, owner, repo, branch, target } = req.body;
    
    // Validate required fields
    if (!token || !owner || !repo || !branch) {
      return res.status(400).json({ 
        error: "Missing required fields: token, owner, repo, branch" 
      });
    }

    if (!target || !target.language || !target.framework || !target.database) {
      return res.status(400).json({ 
        error: "Missing or incomplete target specification (language, framework, database required)" 
      });
    }

    console.log(`Starting conversion for ${owner}/${repo}:${branch} to ${target.language}/${target.framework}/${target.database}`);
    
    // Fetch all files
    const originals = await fetchFiles(token, owner, repo, branch);
    
    if (originals.length === 0) {
      return res.json({ 
        files: [], 
        message: "No code files found in repository" 
      });
    }

    // Create smaller batches for better conversion reliability
    const batches = [];
    const sizeLimit = 40000; // Reduced size limit
    let currentBatch = [];
    let currentSize = 0;

    for (const file of originals) {
      const fileSize = file.content.length;
      
      // If adding this file would exceed the limit and we have files in current batch
      if (currentSize + fileSize > sizeLimit && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = 0;
      }
      
      currentBatch.push(file);
      currentSize += fileSize;
    }
    
    // Add the last batch if it has files
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    console.log(`Created ${batches.length} batches for conversion`);

    // Convert batches sequentially with proper error handling
    const converted = [];
    const errors = [];
    
    for (let i = 0; i < batches.length; i++) {
      console.log(`Converting batch ${i + 1}/${batches.length}`);
      
      try {
        const batchResult = await convertBatch(batches[i], target);
        converted.push(...batchResult);
        console.log(`Successfully converted batch ${i + 1}/${batches.length}`);
      } catch (conversionError) {
        console.error(`Error converting batch ${i + 1}:`, conversionError.message);
        errors.push({
          batch: i + 1,
          error: conversionError.message,
          fileCount: batches[i].length
        });
        
        // Continue with other batches rather than failing completely
        continue;
      }
      
      // Add delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (converted.length === 0) {
      return res.status(500).json({
        error: "Conversion failed for all batches",
        details: errors,
        message: "No files were successfully converted. Please check the error details and try again."
      });
    }

    console.log(`Conversion completed. Successfully processed ${converted.length} files from ${originals.length} originals`);

    const response = { 
      files: converted,
      stats: {
        originalFiles: originals.length,
        convertedFiles: converted.length,
        batches: batches.length,
        successfulBatches: batches.length - errors.length,
        target: target
      }
    };

    // Include errors if any occurred but some files were still converted
    if (errors.length > 0) {
      response.warnings = {
        message: `${errors.length} batches failed to convert`,
        errors: errors
      };
    }

    res.json(response);

  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;