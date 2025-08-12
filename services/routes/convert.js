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

// Improved file detection - includes more file types
function isRelevantFile(path) {
  // Skip common ignored directories and files
  const skipPatterns = [
    /node_modules\//,
    /\.git\//,
    /\.DS_Store$/,
    /\.log$/,
    /\.cache\//,
    /dist\//,
    /build\//,
    /coverage\//,
    /\.nyc_output\//,
    /\.vscode\//,
    /\.idea\//
  ];
  
  if (skipPatterns.some(pattern => pattern.test(path))) {
    return false;
  }

  // Include code files, config files, documentation, etc.
  const relevantExtensions = /\.(ts|tsx|js|jsx|py|cs|java|go|rs|php|rb|kt|scala|sql|sh|yml|yaml|json|html|css|scss|less|md|txt|env|gitignore|toml|xml|properties|conf|ini|dockerfile|makefile|gradle|maven|pom|package|lock|requirements|gemfile|cargo|composer)$/i;
  
  // Also include files without extensions that are commonly important
  const importantFiles = /^(dockerfile|makefile|rakefile|gulpfile|gruntfile|webpack\.config|rollup\.config|vite\.config|tsconfig|jsconfig|babel\.config|eslint|prettier|package|requirements|gemfile|cargo|composer)$/i;
  
  const filename = path.split('/').pop() || '';
  
  return relevantExtensions.test(path) || importantFiles.test(filename);
}

// Get file priority for processing order
function getFilePriority(path) {
  const filename = path.toLowerCase();
  
  // High priority - core config files
  if (filename.includes('package.json') || filename.includes('requirements.txt') || 
      filename.includes('gemfile') || filename.includes('cargo.toml') ||
      filename.includes('pom.xml') || filename.includes('composer.json')) {
    return 1;
  }
  
  // Medium priority - main application files
  if (filename.includes('main') || filename.includes('index') || 
      filename.includes('app.') || filename.includes('server.')) {
    return 2;
  }
  
  // Normal priority
  return 3;
}

async function fetchFiles(token, owner, repo, branch) {
  console.log(`Fetching files for ${owner}/${repo}:${branch}`);
  
  const branchInfo = await gh(token, `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  const sha = branchInfo?.commit?.sha;
  
  if (!sha) {
    throw new Error(`Could not find SHA for branch ${branch}`);
  }
  
  const tree = await gh(token, `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const allFiles = (tree.tree || [])
    .filter((n) => n.type === "blob" && isRelevantFile(n.path));
  
  // Sort by priority and then alphabetically
  const sortedFiles = allFiles.sort((a, b) => {
    const priorityA = getFilePriority(a.path);
    const priorityB = getFilePriority(b.path);
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    return a.path.localeCompare(b.path);
  });
  
  // Increased limit but still reasonable
  const filesToProcess = sortedFiles.slice(0, 200);
  
  console.log(`Found ${allFiles.length} relevant files, processing top ${filesToProcess.length}`);
  
  const results = [];
  const batchSize = 10; // Increased batch size for efficiency
  
  for (let i = 0; i < filesToProcess.length; i += batchSize) {
    const batch = filesToProcess.slice(i, i + batchSize);
    const batchPromises = batch.map(async (f) => {
      try {
        const contentResp = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}?ref=${encodeURIComponent(branch)}`);
        const decoded = Buffer.from(contentResp.content, 'base64').toString('utf-8');
        
        // Skip very large files (>100KB) to avoid API issues
        if (decoded.length > 100000) {
          console.warn(`Skipping large file: ${f.path} (${decoded.length} chars)`);
          return null;
        }
        
        return { 
          path: f.path, 
          content: decoded,
          size: decoded.length,
          priority: getFilePriority(f.path)
        };
      } catch (error) {
        console.error(`Error fetching ${f.path}:`, error.message);
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(Boolean));
    
    // Small delay between batches to respect rate limits
    if (i + batchSize < filesToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`Successfully fetched ${results.length} files`);
  return results;
}

async function convertBatch(batch, target, batchIndex) {
  if (!OPENROUTER_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable");
  }

  // Enhanced system prompt
  const sys = `You are a senior software engineer specializing in complete application migration and conversion.

CRITICAL TASK: Convert ALL provided files from the source codebase to the target technology stack. This is a complete application migration - every file must be converted or have an equivalent in the target stack.

TARGET STACK:
- Language: ${target.language}
- Framework: ${target.framework} 
- Database: ${target.database}

CONVERSION REQUIREMENTS:
1. Convert EVERY source file to its equivalent in ${target.language}
2. Maintain the same directory structure when possible
3. Update ALL file extensions to match ${target.language} conventions
4. Convert ALL imports, dependencies, and package references
5. Adapt ALL database queries/models for ${target.database}
6. Preserve ALL functionality and business logic
7. Follow ${target.framework} patterns and best practices
8. Include necessary configuration files for the target stack

IMPORTANT FILE TYPES TO HANDLE:
- Source code files: Convert language syntax completely
- Config files (package.json, requirements.txt, etc.): Create equivalent for target stack
- Database files: Convert to ${target.database} syntax
- Documentation: Update with new stack information
- Environment files: Maintain but update variable names if needed
- Build files: Create equivalent build configuration

OUTPUT FORMAT - Return ONLY this JSON structure:
{
  "files": [
    {
      "path": "new/file/path.ext",
      "content": "complete converted file content",
      "originalPath": "original/file/path"
    }
  ]
}

Do not include any explanations, markdown, or text outside the JSON.`;

  // Create detailed file content with metadata
  const fileContents = batch.map((file, index) => 
    `=== FILE ${index + 1}: ${file.path} (${file.size} chars, priority: ${file.priority}) ===\n${file.content}\n`
  ).join('\n\n');

  const userMessage = `BATCH ${batchIndex}: Convert these ${batch.length} files to ${target.language}/${target.framework}/${target.database}. 

ENSURE COMPLETE CONVERSION - do not skip any files:

${fileContents}`;

  console.log(`Converting batch ${batchIndex} of ${batch.length} files to ${target.language}/${target.framework}`);

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
        model: "z-ai/glm-4.5-air:free", // More capable model for complex conversions
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMessage }
        ],

      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`OpenRouter API error ${resp.status}:`, errorText);
      throw new Error(`OpenRouter API error ${resp.status}: ${errorText}`);
    }

    const data = await resp.json();
    const aiResponse = data?.choices?.[0]?.message?.content || "";
    
    console.log(`AI Response for batch ${batchIndex} - length: ${aiResponse.length}`);
    
    // Parse JSON response
    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch (e) {
      // Try to extract JSON from response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          throw new Error(`Failed to parse AI response as JSON: ${e2.message}`);
        }
      } else {
        throw new Error('AI response does not contain valid JSON');
      }
    }
    
    // Validate response structure
    if (!parsed || !Array.isArray(parsed.files)) {
      throw new Error('AI response missing files array');
    }
    
    // Validate and clean file entries
    const validFiles = parsed.files.filter(file => {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
        console.warn(`Batch ${batchIndex}: Skipping invalid file entry:`, file?.path || 'unknown');
        return false;
      }
      return true;
    });
    
    if (validFiles.length === 0) {
      throw new Error(`Batch ${batchIndex}: No valid files in AI response`);
    }
    
    // Check if we got files for all input files
    const inputFileCount = batch.length;
    const outputFileCount = validFiles.length;
    
    if (outputFileCount < inputFileCount) {
      console.warn(`Batch ${batchIndex}: Input files: ${inputFileCount}, Output files: ${outputFileCount} - some files may be missing`);
    }
    
    console.log(`Batch ${batchIndex}: Successfully converted ${validFiles.length} files`);
    return validFiles;
    
  } catch (error) {
    console.error(`Batch ${batchIndex} conversion error:`, error.message);
    throw error;
  }
}

// Fallback conversion for failed batches - creates stub files to maintain structure
function createFallbackFiles(batch, target) {
  console.log(`Creating fallback files for ${batch.length} files`);
  
  return batch.map(file => {
    // Determine target file extension
    let targetExt = '';
    switch (target.language.toLowerCase()) {
      case 'python':
        targetExt = '.py';
        break;
      case 'javascript':
      case 'node.js':
        targetExt = '.js';
        break;
      case 'typescript':
        targetExt = '.ts';
        break;
      case 'java':
        targetExt = '.java';
        break;
      case 'c#':
      case 'csharp':
        targetExt = '.cs';
        break;
      case 'go':
        targetExt = '.go';
        break;
      default:
        targetExt = '.txt';
    }
    
    // Convert path
    const pathParts = file.path.split('.');
    const newPath = pathParts.slice(0, -1).join('.') + targetExt;
    
    // Create basic converted content
    const fallbackContent = `// FALLBACK CONVERSION - NEEDS MANUAL REVIEW
// Original file: ${file.path}
// Target: ${target.language} with ${target.framework}
// TODO: Convert the following original content to ${target.language}

/*
Original content:
${file.content.substring(0, 1000)}${file.content.length > 1000 ? '\n... (truncated)' : ''}
*/

// Add your converted ${target.language} code here`;

    return {
      path: newPath,
      content: fallbackContent,
      originalPath: file.path,
      isFallback: true
    };
  });
}

// Convert repository endpoint
router.post('/', async (req, res) => {
  try {
    const { token, owner, repo, branch, target } = req.body;
    
    // Validation
    if (!token || !owner || !repo || !branch) {
      return res.status(400).json({ 
        error: "Missing required fields: token, owner, repo, branch" 
      });
    }

    if (!target || !target.language || !target.framework || !target.database) {
      return res.status(400).json({ 
        error: "Missing target specification (language, framework, database required)" 
      });
    }

    console.log(`Starting conversion: ${owner}/${repo}:${branch} → ${target.language}/${target.framework}/${target.database}`);
    
    // Fetch all relevant files
    const originals = await fetchFiles(token, owner, repo, branch);
    
    if (originals.length === 0) {
      return res.json({ 
        files: [], 
        message: "No relevant files found in repository" 
      });
    }

    // Create intelligent batches based on content size and file relationships
    const batches = [];
    const sizeLimit = 80000; // Increased size limit
    let currentBatch = [];
    let currentSize = 0;

    // Group related files together when possible
    const fileGroups = {
      config: originals.filter(f => f.priority === 1),
      main: originals.filter(f => f.priority === 2),
      others: originals.filter(f => f.priority === 3)
    };

    // Process each group
    for (const [groupName, files] of Object.entries(fileGroups)) {
      for (const file of files) {
        const fileSize = file.content.length;
        
        if (currentSize + fileSize > sizeLimit && currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentSize = 0;
        }
        
        currentBatch.push(file);
        currentSize += fileSize;
      }
    }
    
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    console.log(`Created ${batches.length} intelligent batches for conversion`);

    // Convert batches with comprehensive error handling
    const converted = [];
    const failedFiles = [];
    const batchResults = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batchIndex = i + 1;
      console.log(`Processing batch ${batchIndex}/${batches.length} (${batches[i].length} files)`);
      
      try {
        const batchResult = await convertBatch(batches[i], target, batchIndex);
        converted.push(...batchResult);
        batchResults.push({
          batch: batchIndex,
          status: 'success',
          fileCount: batchResult.length
        });
        
      } catch (conversionError) {
        console.error(`Batch ${batchIndex} failed:`, conversionError.message);
        
        // Create fallback files to maintain application structure
        const fallbackFiles = createFallbackFiles(batches[i], target);
        converted.push(...fallbackFiles);
        failedFiles.push(...batches[i]);
        
        batchResults.push({
          batch: batchIndex,
          status: 'fallback',
          error: conversionError.message,
          fileCount: fallbackFiles.length
        });
      }
      
      // Rate limiting delay
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const successfulBatches = batchResults.filter(b => b.status === 'success').length;
    const fallbackBatches = batchResults.filter(b => b.status === 'fallback').length;
    
    console.log(`Conversion completed: ${converted.length} files processed (${successfulBatches} successful batches, ${fallbackBatches} fallback batches)`);

    const response = { 
      files: converted,
      summary: {
        totalOriginalFiles: originals.length,
        totalConvertedFiles: converted.length,
        successfullyConverted: converted.filter(f => !f.isFallback).length,
        fallbackFiles: converted.filter(f => f.isFallback).length,
        batchResults: batchResults,
        target: target
      }
    };

    // Add warnings for fallback files
    if (fallbackBatches > 0) {
      response.warnings = {
        message: `${fallbackBatches} batches required fallback conversion`,
        details: "Some files were converted using fallback method and need manual review",
        fallbackFiles: converted.filter(f => f.isFallback).map(f => f.originalPath)
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