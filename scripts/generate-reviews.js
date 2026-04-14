#!/usr/bin/env node
/**
 * 独立长文生成脚本
 * 从 alphaxiv-daily.md 解析论文，串行生成长文
 * 
 * 用法:
 *   node generate-reviews.js                    # 处理今天的 daily
 *   node generate-reviews.js 2026-04-01         # 指定日期
 *   node generate-reviews.js --dry-run           # 只显示要处理的论文
 *   node generate-reviews.js --skip-existing     # 跳过已有长文
 *   node generate-reviews.js 2603.28627          # 只处理指定 arxiv ID
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Config ───
const CONFIG = {
  proxyPatch: '/home/useradmin/fetch-patch.cjs',
  zhipuApiKey: 'f6efdb78d38248ccaa04e504d8615469.UFCOZXA1JxTPRNyK',
  zhipuBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  dailyPath: '/home/useradmin/agent_workspace/data/alphaxiv-daily.md',
  reviewBaseDir: '/home/useradmin/agent_workspace/data/paper-reviews',
  papersDir: '/home/useradmin/agent_workspace/data/papers',
  telegramTarget: '5740650457',
  // 每个 Gemini 调用的超时（秒），避免无限重试
  geminiTimeout: 90,
  // GLM-5 超时
  glmTimeout: 300,
  // 最小长文大小（字节）
  minReviewSize: 500,
};

// ─── Parse CLI args ───
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipExisting = args.includes('--skip-existing');
const dateArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const arxivArg = args.find(a => /^\d{4}\.\d{4,5}$/.test(a));

// ─── Parse alphaxiv-daily.md ───
function parseDaily(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const papers = [];
  
  // Match patterns like: arXiv:2603.28627
  const arxivRegex = /arXiv:(\d{4}\.\d{4,5})/g;
  let match;
  const seenIds = new Set();
  
  while ((match = arxivRegex.exec(content)) !== null) {
    const arxivId = match[1];
    if (seenIds.has(arxivId)) continue;
    seenIds.add(arxivId);
    
    // Find the title (line before the one containing arXiv ID)
    const lines = content.split('\n');
    let title = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`arXiv:${arxivId}`)) {
        // Title is in a preceding bold line like 🥇 **Title**
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const titleMatch = lines[j].match(/\*\*(.+?)\*\*/);
          if (titleMatch) {
            title = titleMatch[1];
            break;
          }
        }
        break;
      }
    }
    
    papers.push({ arxivId, title: title || arxivId });
  }
  
  return papers;
}

// ─── Download PDF ───
function downloadPaperPDF(arxivId, today) {
  const papersDir = `${CONFIG.papersDir}/${today}`;
  const pdfPath = `${papersDir}/${arxivId}.pdf`;

  if (!fs.existsSync(papersDir)) {
    fs.mkdirSync(papersDir, { recursive: true });
  }

  if (fs.existsSync(pdfPath)) {
    const stats = fs.statSync(pdfPath);
    if (stats.size > 10000) {
      console.log(`  ✅ PDF 已存在: ${pdfPath} (${(stats.size / 1024).toFixed(1)} KB)`);
      return pdfPath;
    }
  }

  console.log(`  📥 下载 PDF ${arxivId}...`);
  try {
    const cmd = `NODE_OPTIONS='--require ${CONFIG.proxyPatch}' curl -sL -o "${pdfPath}" "https://arxiv.org/pdf/${arxivId}"`;
    execSync(cmd, { encoding: 'utf-8', timeout: 120000 });
    const stats = fs.statSync(pdfPath);
    if (stats.size < 10000) {
      console.error(`  ⚠️ PDF 太小 (${stats.size} bytes)`);
      fs.unlinkSync(pdfPath);
      return null;
    }
    console.log(`  ✅ PDF 已下载: ${(stats.size / 1024).toFixed(1)} KB`);
    return pdfPath;
  } catch (error) {
    console.error(`  ⚠️ 下载 PDF 失败: ${error.message}`);
    return null;
  }
}

// ─── Download HTML text ───
function downloadPaperText(arxivId) {
  const paperFile = `/tmp/paper-${arxivId}.txt`;
  console.log(`  📥 下载论文全文 ${arxivId} (HTML)...`);
  try {
    const cmd = `NODE_OPTIONS='--require ${CONFIG.proxyPatch}' curl -sL "https://arxiv.org/html/${arxivId}" | sed 's/<[^>]*>//g' | sed '/^[[:space:]]*$/d' > ${paperFile}`;
    execSync(cmd, { encoding: 'utf-8', timeout: 120000 });
    const stats = fs.statSync(paperFile);
    if (stats.size < 500) {
      console.error(`  ⚠️ 全文太小 (${stats.size} bytes)`);
      return null;
    }
    console.log(`  ✅ 全文已下载 (${(stats.size / 1024).toFixed(1)} KB)`);
    return paperFile;
  } catch (error) {
    console.error(`  ⚠️ 下载全文失败: ${error.message}`);
    return null;
  }
}

// ─── Extract review content from raw output ───
function extractReviewContent(output) {
  const lines = output.split('\n');
  let contentStarted = false;
  let content = [];
  for (const line of lines) {
    if (!contentStarted && (line.startsWith('# ') || line.startsWith('## '))) {
      contentStarted = true;
    }
    if (contentStarted) content.push(line);
  }
  return content.length > 0 ? content.join('\n').trim() : output.trim();
}

// ─── Generate review with Gemini CLI ───
function generateReviewWithGemini(arxivId, title, today, paperFile, model = 'gemini-3.1-pro-preview') {
  const reviewDir = `${CONFIG.reviewBaseDir}/${today}`;
  const reviewPath = `${reviewDir}/${arxivId}.md`;

  if (!fs.existsSync(reviewDir)) {
    fs.mkdirSync(reviewDir, { recursive: true });
  }

  const task = `请分析这篇 arXiv 论文并写一篇详细的长文。

请先读取论文 PDF 获取论文内容：@${paperFile}

论文链接：https://arxiv.org/abs/${arxivId}

要求：
1. 搜索这篇论文的相关内容，整合
2. 仔细阅读论文 PDF 原文
3. 长文必须包含以下章节：
   - 标题（论文原标题 + 中文翻译）
   - 论文信息（作者、机构、arXiv 链接）
   - 背景与动机
   - 核心方法
   - 实验设计
   - 结果与分析
   - 评价与思考（个人见解，要有深度）
   - 适用场景
4. 用 Markdown 格式
5. 最后写完后，将完整长文保存到文件：${reviewPath}

重要：一定要把完整内容写入 ${reviewPath} 文件！`;

  console.log(`  💎 Gemini ${model} 写长文...`);

  try {
    const taskFile = `/tmp/gemini-task-${arxivId}.txt`;
    fs.writeFileSync(taskFile, task, 'utf-8');

    const cmd = `timeout ${CONFIG.geminiTimeout}s gemini -y -m ${model} -p "$(cat ${taskFile})"`;
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: (CONFIG.geminiTimeout + 10) * 1000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: reviewDir,  // 直接在 agent_workspace 的 review 目录工作
    });

    try { fs.unlinkSync(taskFile); } catch (e) {}

    // Check if file was written
    if (fs.existsSync(reviewPath)) {
      const fileSize = fs.statSync(reviewPath).size;
      if (fileSize >= CONFIG.minReviewSize) {
        console.log(`  ✅ Gemini 完成: ${arxivId} (${(fileSize / 1024).toFixed(1)} KB)`);
        return { success: true, method: model };
      }
      console.error(`  ⚠️ 文件太小 (${fileSize} bytes)`);
      try { fs.unlinkSync(reviewPath); } catch (e) {}
    }

    // Try extract from output
    const content = extractReviewContent(result);
    if (content && content.length > CONFIG.minReviewSize) {
      fs.writeFileSync(reviewPath, content, 'utf-8');
      console.log(`  ✅ 从输出提取并保存: ${arxivId} (${(content.length / 1024).toFixed(1)} KB)`);
      return { success: true, method: model };
    }

    console.error(`  ⚠️ Gemini 无有效内容`);
    return { success: false, error: 'No review content' };

  } catch (error) {
    // Timeout - check if partial file exists
    if (fs.existsSync(reviewPath)) {
      const fileSize = fs.statSync(reviewPath).size;
      if (fileSize >= CONFIG.minReviewSize) {
        console.log(`  ✅ 超时但文件已生成: ${arxivId} (${(fileSize / 1024).toFixed(1)} KB)`);
        return { success: true, method: model };
      }
      try { fs.unlinkSync(reviewPath); } catch (e) {}
    }
    console.error(`  ⚠️ Gemini 失败: ${error.message.slice(0, 100)}`);
    return { success: false, error: error.message.slice(0, 100) };
  }
}

// ─── Generate review with GLM-5 API ───
function generateReviewWithGLM(arxivId, title, today, paperFile) {
  const reviewDir = `${CONFIG.reviewBaseDir}/${today}`;
  const reviewPath = `${reviewDir}/${arxivId}.md`;

  if (!fs.existsSync(reviewDir)) {
    fs.mkdirSync(reviewDir, { recursive: true });
  }

  let paperContent = '';
  try {
    paperContent = fs.readFileSync(paperFile, 'utf-8');
  } catch (e) {
    console.error(`  ⚠️ 读取论文全文失败: ${e.message}`);
  }

  const task = `请分析这篇 arXiv 论文并写一篇详细的中文长文（1500-2000字）。

论文标题：${title}
论文全文：
${paperContent.slice(0, 50000)}

要求：
1. 仔细阅读论文全文
2. 长文必须包含以下章节：
   - 标题（论文原标题 + 中文翻译）
   - 论文信息（作者、机构、arXiv 链接）
   - 背景与动机
   - 核心方法
   - 实验设计
   - 结果与分析
   - 评价与思考（个人见解，要有深度）
   - 适用场景
3. 用 Markdown 格式

直接输出长文内容，不要加前缀：`;

  console.log(`  🔄 GLM-5 写长文...`);

  const payloadFile = `/tmp/glm-review-${arxivId}-${Date.now()}.json`;
  try {
    const payload = {
      model: 'glm-5.1',
      messages: [{ role: 'user', content: task }],
      max_tokens: 200000,
      temperature: 0.7
    };

    fs.writeFileSync(payloadFile, JSON.stringify(payload), 'utf-8');
    const cmd = `NODE_OPTIONS='--require ${CONFIG.proxyPatch}' curl -sL -X POST \
      "${CONFIG.zhipuBaseUrl}/chat/completions" \
      -H "Authorization: Bearer ${CONFIG.zhipuApiKey}" \
      -H "Content-Type: application/json" \
      -d @${payloadFile}`;

    const response = execSync(cmd, {
      encoding: 'utf-8',
      timeout: CONFIG.glmTimeout * 1000,
      maxBuffer: 10 * 1024 * 1024
    });

    const data = JSON.parse(response);
    const content = data.choices?.[0]?.message?.content;

    if (content && content.length > CONFIG.minReviewSize) {
      const reviewContent = extractReviewContent(content);
      if (reviewContent.length >= CONFIG.minReviewSize) {
        fs.writeFileSync(reviewPath, reviewContent, 'utf-8');
        console.log(`  ✅ GLM-5 完成: ${arxivId} (${(reviewContent.length / 1024).toFixed(1)} KB)`);
        return { success: true, method: 'glm-5' };
      }
    }
    console.error(`  ❌ GLM-5 内容为空或太短 (${content?.length || 0} chars)`);
    return { success: false, error: 'GLM-5 empty content' };

  } catch (error) {
    console.error(`  ❌ GLM-5 失败: ${error.message.slice(0, 100)}`);
    return { success: false, error: error.message.slice(0, 100) };
  } finally {
    try { fs.unlinkSync(payloadFile); } catch (e) {}
  }
}

// ─── Generate review for one paper (with fallback chain) ───
function generateReview(arxivId, title, today) {
  const reviewDir = `${CONFIG.reviewBaseDir}/${today}`;
  const reviewPath = `${reviewDir}/${arxivId}.md`;

  // Skip if exists
  if (skipExisting && fs.existsSync(reviewPath)) {
    const size = fs.statSync(reviewPath).size;
    if (size >= CONFIG.minReviewSize) {
      console.log(`  ⏭️  已存在，跳过: ${arxivId} (${(size / 1024).toFixed(1)} KB)`);
      return { arxivId, success: true, method: 'existing', skipped: true };
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📝 ${arxivId} — ${title}`);
  console.log(`${'─'.repeat(60)}`);

  // 1. Download PDF
  const pdfPath = downloadPaperPDF(arxivId, today);

  // 2. Gemini 3.1 Pro + PDF (fast fail with timeout)
  if (pdfPath) {
    const proResult = generateReviewWithGemini(arxivId, title, today, pdfPath, 'gemini-3.1-pro-preview');
    if (proResult.success) return { arxivId, ...proResult };
    console.log(`  🔄 Pro 失败，尝试 Flash...`);
  }

  // 3. Gemini Flash + PDF
  if (pdfPath) {
    const flashResult = generateReviewWithGemini(arxivId, title, today, pdfPath, 'gemini-3-flash-preview');
    if (flashResult.success) return { arxivId, ...flashResult };
    console.log(`  🔄 Flash 也失败，尝试 HTML...`);
  }

  // 4. Download HTML + Gemini Flash
  const htmlPath = downloadPaperText(arxivId);
  if (htmlPath) {
    const flashHtmlResult = generateReviewWithGemini(arxivId, title, today, htmlPath, 'gemini-3-flash-preview');
    if (flashHtmlResult.success) return { arxivId, ...flashHtmlResult };
    console.log(`  🔄 Flash HTML 也失败，切换 GLM-5...`);
  }

  // 5. GLM-5 fallback
  const glmResult = generateReviewWithGLM(arxivId, title, today, htmlPath || `/tmp/paper-${arxivId}.txt`);
  return { arxivId, ...glmResult };
}

// ─── Push review to Telegram ───
function pushToTelegram(arxivId, title, today) {
  const reviewDir = `${CONFIG.reviewBaseDir}/${today}`;
  let reviewPath = `${reviewDir}/${arxivId}.md`;

  if (!fs.existsSync(reviewPath)) {
    const files = fs.readdirSync(reviewDir).filter(f => f.startsWith(arxivId) && f.endsWith('.md'));
    if (files.length > 0) reviewPath = `${reviewDir}/${files[0]}`;
    else return false;
  }

  const content = fs.readFileSync(reviewPath, 'utf-8');
  const fullContent = `📄 **${title}**\n\n${content}`;

  const MAX_CHUNK = 3500;
  const chunks = [];
  const lines = fullContent.split('\n');
  let currentChunk = '';
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > MAX_CHUNK) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());

  let sentCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const tempFile = `/tmp/review-${arxivId}-${i}-${Date.now()}.txt`;
    fs.writeFileSync(tempFile, chunks[i], 'utf-8');
    try {
      execSync(`/home/useradmin/agent_workspace/scripts/tg-send.sh ${CONFIG.telegramTarget} --file ${tempFile}`, {
        encoding: 'utf-8',
        timeout: 15000
      });
      sentCount++;
    } catch (e) {
      console.error(`  ❌ 推送失败 (chunk ${i}): ${e.message.slice(0, 80)}`);
    }
    try { fs.unlinkSync(tempFile); } catch (e) {}
    if (i < chunks.length - 1) {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      wait(1500);
    }
  }
  console.log(`  ✅ 已推送 ${sentCount} 段到 Telegram`);
  return sentCount > 0;
}

// ─── Main ───
async function main() {
  // Determine date
  const today = dateArg || new Date().toISOString().slice(0, 10);
  console.log(`📅 日期: ${today}`);
  console.log(`📄 Daily 文件: ${CONFIG.dailyPath}\n`);

  // Parse papers
  let papers = parseDaily(CONFIG.dailyPath);
  if (papers.length === 0) {
    console.error('❌ 未找到论文，检查 daily 文件');
    process.exit(1);
  }

  // Filter by arxiv ID if specified
  if (arxivArg) {
    papers = papers.filter(p => p.arxivId === arxivArg);
    if (papers.length === 0) {
      console.error(`❌ 未找到 ${arxivArg}`);
      process.exit(1);
    }
  }

  console.log(`📋 找到 ${papers.length} 篇论文:\n`);
  papers.forEach((p, i) => console.log(`  ${i + 1}. ${p.arxivId} — ${p.title}`));

  // Pre-check: 预下载所有 PDF
  console.log(`\n📥 预检 PDF...`);
  const papersDir = `${CONFIG.papersDir}/${today}`;
  if (!fs.existsSync(papersDir)) {
    fs.mkdirSync(papersDir, { recursive: true });
  }

  let allReady = true;
  for (const paper of papers) {
    const pdfPath = `${papersDir}/${paper.arxivId}.pdf`;
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 10000) {
      console.log(`  ✅ ${paper.arxivId}.pdf 已存在`);
    } else {
      console.log(`  📥 ${paper.arxivId}.pdf 需要下载...`);
      const result = downloadPaperPDF(paper.arxivId, today);
      if (!result) {
        console.error(`  ⚠️ ${paper.arxivId} PDF 下载失败，将尝试 HTML fallback`);
        allReady = false;
      }
    }
  }
  if (allReady) {
    console.log(`  ✅ 所有 PDF 就绪\n`);
  } else {
    console.log(`  ⚠️ 部分缺失，会尝试 HTML 补救\n`);
  }

  if (dryRun) {
    console.log('🔍 --dry-run 模式，不执行');
    process.exit(0);
  }

  // Process papers serially
  const results = [];
  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[${i + 1}/${papers.length}]`);
    const result = generateReview(paper.arxivId, paper.title, today);
    results.push(result);

    // Push immediately if successful
    if (result.success && !result.skipped) {
      pushToTelegram(paper.arxivId, paper.title, today);
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 结果汇总:');
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  console.log(`  ✅ 成功: ${success.length}/${results.length}`);
  if (failed.length > 0) {
    console.log(`  ❌ 失败:`);
    failed.forEach(r => console.log(`     - ${r.arxivId}: ${r.error}`));
  }
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
