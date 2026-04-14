#!/usr/bin/env node
/**
 * AlphaXiv 热门论文抓取器
 * 每日获取 AlphaXiv 上最受关注的 AI 论文
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置
const CONFIG = {
  url: 'https://alphaxiv.org/explore?sort=Hot',
  minLikes: 5,        // 最低点赞数
  maxPapers: 5,       // 最多返回论文数
  timeout: 30000,
  proxyPatch: '/home/useradmin/fetch-patch.cjs',
  outputPath: '/home/useradmin/agent_workspace/data/alphaxiv-daily.md',
  historyPath: '/home/useradmin/agent_workspace/data/alphaxiv-history.json',
  backupDir: '/home/useradmin/agent_workspace/data/alphaxiv-archives',
  historyDays: 30,    // 保留 30 天的历史记录
  zhipuApiKey: 'f6efdb78d38248ccaa04e504d8615469.UFCOZXA1JxTPRNyK',
  zhipuBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4'
};

/**
 * 使用代理补丁获取 AlphaXiv 页面
 */
async function fetchAlphaXiv() {
  const cmd = `NODE_OPTIONS='--require ${CONFIG.proxyPatch}' curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${CONFIG.url}"`;
  
  try {
    const html = execSync(cmd, { 
      encoding: 'utf-8',
      timeout: CONFIG.timeout,
      maxBuffer: 10 * 1024 * 1024
    });
    return html;
  } catch (error) {
    console.error('❌ 获取页面失败:', error.message);
    return null;
  }
}

/**
 * 从 HTML 提取论文数据 - v2 (从嵌入的 React SSR 数据解析)
 * AlphaXiv 现在是 React SPA，论文数据嵌在 <script> 标签内的 JSON 中
 */
function parsePapers(html) {
  // 优先从嵌入数据解析
  const embedded = parsePapersFromEmbeddedData(html);
  if (embedded.length > 0) {
    console.log(`📋 从嵌入数据解析到 ${embedded.length} 篇论文`);
    return embedded;
  }
  // 降级到 HTML 卡片解析
  console.log('⚠️ 嵌入数据解析失败，降级到 HTML 解析...');
  return parsePapersLegacy(html);
}

/**
 * 从嵌入的 dehydrated React Query 数据中提取论文
 */
function parsePapersFromEmbeddedData(html) {
  const papers = [];
  
  // 数据格式: universal_paper_id:"XXXX.XXXXX",...metrics:$R[N]={visits_count:$R[N]={all:NNNN},...,public_total_votes:NN,...}
  const paperIdPattern = /universal_paper_id:"(\d+\.\d+)"/g;
  let match;
  const seenIds = new Set();
  
  while ((match = paperIdPattern.exec(html)) !== null) {
    const arxiv_id = match[1];
    if (seenIds.has(arxiv_id)) continue;
    seenIds.add(arxiv_id);
    
    const pos = match.index;
    
    try {
      // 向前搜索 title:"..."（论文标题在 universal_paper_id 之前）
      const before = html.substring(Math.max(0, pos - 6000), pos);
      const titleMatches = [...before.matchAll(/title:"((?:[^"\\]|\\.)*)"/g)];
      if (titleMatches.length === 0) continue;
      const title = titleMatches[titleMatches.length - 1][1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, ' ')
        .trim();
      if (title.length < 10) continue;
      
      // 向后搜索 metrics 数据
      const after = html.substring(pos, Math.min(html.length, pos + 3000));
      
      // public_total_votes（页面显示的点赞数）
      const votesMatch = after.match(/public_total_votes:(\d+)/);
      const likes = votesMatch ? parseInt(votesMatch[1]) : 0;
      
      // visits_count -> all（浏览量）
      const viewsMatch = after.match(/visits_count:\$R\[\d+\]=\{all:(\d+)/);
      const views = viewsMatch ? parseInt(viewsMatch[1]) : 0;
      
      if (likes > 0 || views > 0) {
        papers.push({ arxiv_id, title, likes, views });
      }
    } catch (e) {
      continue;
    }
  }
  
  return papers;
}

/**
 * 旧版 HTML 卡片解析（降级方案）
 */
function parsePapersLegacy(html) {
  const papers = [];
  const cardBlocks = html.split(/<div class="rounded-xl border-\[0\.5px\]/).slice(1);
  
  for (const block of cardBlocks) {
    try {
      const idMatch = block.match(/href="\/abs\/(\d+\.\d+)"/);
      if (!idMatch) continue;
      const arxiv_id = idMatch[1];
      
      const titleMatch = block.match(/text-\[22px\][^>]*>([^<]+)<\/div>/);
      if (!titleMatch) continue;
      const title = titleMatch[1].trim();
      
      const likesMatch = block.match(/lucide-thumbs-up[\s\S]*?<span>(\d+)<\/span>/);
      const likes = likesMatch ? parseInt(likesMatch[1]) : 0;
      
      const viewsMatch = block.match(/lucide-chart-no-axes-combined[\s\S]*?<span>([\d,]+)<\/span>/);
      const views = viewsMatch ? parseInt(viewsMatch[1].replace(',', '')) : 0;
      
      if (likes > 0) {
        papers.push({ arxiv_id, title, likes, views });
      }
    } catch (e) {
      continue;
    }
  }
  
  const seen = new Set();
  return papers.filter(p => {
    if (seen.has(p.arxiv_id)) return false;
    seen.add(p.arxiv_id);
    return true;
  });
}

/**
 * 筛选和排序论文
 */
function filterAndSort(papers) {
  return papers
    .filter(p => p.likes >= CONFIG.minLikes)
    .sort((a, b) => b.likes - a.likes);
}

/**
 * 加载历史记录
 */
function loadHistory() {
  try {
    if (fs.existsSync(CONFIG.historyPath)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.historyPath, 'utf-8'));
      // 清理过期记录 (超过 historyDays 天)
      const cutoff = Date.now() - CONFIG.historyDays * 24 * 60 * 60 * 1000;
      data.pushed = (data.pushed || []).filter(item => item.date > cutoff);
      return data;
    }
  } catch (e) {
    console.error('⚠️  读取历史记录失败:', e.message);
  }
  return { pushed: [] };
}

/**
 * 保存历史记录
 */
function saveHistory(history) {
  try {
    const outputDir = path.dirname(CONFIG.historyPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.historyPath, JSON.stringify(history, null, 2), 'utf-8');
  } catch (e) {
    console.error('⚠️  保存历史记录失败:', e.message);
  }
}

/**
 * 去重筛选 - 排除已推送的论文
 */
function deduplicate(papers, history) {
  const pushedIds = new Set(history.pushed.map(item => item.arxiv_id));
  return papers.filter(p => !pushedIds.has(p.arxiv_id));
}

/**
 * 更新历史记录
 */
function updateHistory(history, papers) {
  const now = Date.now();
  for (const paper of papers) {
    history.pushed.push({
      arxiv_id: paper.arxiv_id,
      title: paper.title,
      date: now
    });
  }
  // 清理过期记录
  const cutoff = now - CONFIG.historyDays * 24 * 60 * 60 * 1000;
  history.pushed = history.pushed.filter(item => item.date > cutoff);
  return history;
}

/**
 * 从 arXiv 获取论文详细信息（摘要、作者）
 */
async function fetchPaperInfo(arxivId) {
  try {
    const url = `https://arxiv.org/abs/${arxivId}`;
    const cmd = `NODE_OPTIONS='--require ${CONFIG.proxyPatch}' curl -sL -A "Mozilla/5.0" "${url}"`;
    const html = execSync(cmd, { 
      encoding: 'utf-8',
      timeout: 15000
    });
    
    // 提取摘要
    const absMatch = html.match(/<meta name="citation_abstract" content="([^"]+)"/);
    const abstract = absMatch ? absMatch[1].replace(/\s+/g, ' ').trim() : '';
    
    // 提取作者
    const authorMatches = html.matchAll(/<meta name="citation_author" content="([^"]+)"/g);
    const authors = [...authorMatches].map(m => m[1]).slice(0, 5); // 最多5位作者
    
    // 提取机构（第一作者）
    const instMatch = html.match(/<a href="[^"]*" title="([^"]+)" class="link-collaboration"/);
    const institution = instMatch ? instMatch[1] : '';
    
    return { abstract, authors, institution };
  } catch (error) {
    console.error(`  ⚠️  获取 ${arxivId} 信息失败:`, error.message);
    return { abstract: '', authors: [], institution: '' };
  }
}

/**
 * 调用智谱 AI 生成论文评论
 */
async function generateComment(paper) {
  if (!paper.abstract) {
    return '📝 *暂无详细摘要，建议点击链接查看原文*';
  }
  
  const prompt = `你是一个 AI 研究助手。请用中文为以下论文写一段简短的评论：

**标题**: ${paper.title}
**作者**: ${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? ' 等' : ''}
**机构**: ${paper.institution || '未知'}
**摘要**: ${paper.abstract.substring(0, 500)}

要求：
1. 简要说明论文的核心贡献
2. 提及研究意义或应用场景
3. 语气自然、像朋友推荐论文
4. 不要使用标题或列表格式

直接输出评论内容，不要加前缀：`;

  const payloadFile = `/tmp/glm-comment-${Date.now()}.json`;
  const maxRetries = 3;
  try {
    const payload = {
      model: 'glm-5.1',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 20000,
      temperature: 1
    };

    fs.writeFileSync(payloadFile, JSON.stringify(payload), 'utf-8');
    const cmd = `NODE_OPTIONS='--require ${CONFIG.proxyPatch}' curl -sL -X POST \
      "${CONFIG.zhipuBaseUrl}/chat/completions" \
      -H "Authorization: Bearer ${CONFIG.zhipuApiKey}" \
      -H "Content-Type: application/json" \
      -d @${payloadFile}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const response = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 60000,
        maxBuffer: 5 * 1024 * 1024
      });

      const data = JSON.parse(response);

      // 1305: 过载，重试
      if (data.error?.code === '1305') {
        console.error(`  ⚠️  评论生成限流 (1305)，第 ${attempt}/${maxRetries} 次重试...`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 5000));
          continue;
        }
        return '📝 *评论生成失败*';
      }

      return data.choices?.[0]?.message?.content || '📝 *评论生成失败*';
    }
  } catch (error) {
    console.error(`  ⚠️  评论生成失败:`, error.message);
    return '📝 *评论生成失败*';
  } finally {
    try { fs.unlinkSync(payloadFile); } catch (e) {}
  }
}

/**
 * 生成 Markdown 报告
 */
function generateReport(papers) {
  const date = new Date().toLocaleDateString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });
  
  if (papers.length === 0) {
    return `📭 **AlphaXiv 今日热门**\n📅 ${date}\n\n今天没有找到足够热门的论文 (点赞 ≥ ${CONFIG.minLikes})`;
  }
  
  let report = `🔥 **AlphaXiv 今日热门论文**\n`;
  report += `📅 ${date}\n\n`;
  report += `---\n\n`;
  
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  
  papers.forEach((paper, i) => {
    const medal = medals[i] || `${i + 1}.`;
    const title = paper.title.length > 100 ? paper.title.substring(0, 97) + '...' : paper.title;
    
    report += `${medal} **${title}**\n`;
    report += `   👍 ${paper.likes} | 👁 ${paper.views.toLocaleString()}\n`;
    
    // 显示作者和机构
    if (paper.authors && paper.authors.length > 0) {
      const authorsStr = paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' 等' : '');
      report += `   👥 ${authorsStr}\n`;
    }
    if (paper.institution) {
      report += `   🏛️ ${paper.institution}\n`;
    }
    
    report += `   📄 [arXiv:${paper.arxiv_id}](https://arxiv.org/abs/${paper.arxiv_id})`;
    report += ` | 💬 [AlphaXiv](https://alphaxiv.org/abs/${paper.arxiv_id})\n`;
    
    // 添加评论
    if (paper.comment) {
      report += `\n   💭 ${paper.comment}\n`;
    }
    
    report += `\n`;
  });
  
  report += `---\n`;
  report += `_数据来源: [AlphaXiv Hot](https://alphaxiv.org/explore?sort=Hot) | 评论由 AI 生成_`;
  
  return report;
}

/**
 * 下载论文 PDF 到 data/papers/YYYY-MM-DD/
 */
function downloadPaperPDF(arxivId, today) {
  const papersDir = `/home/useradmin/agent_workspace/data/papers/${today}`;
  const pdfPath = `${papersDir}/${arxivId}.pdf`;

  // 确保目录存在
  if (!fs.existsSync(papersDir)) {
    fs.mkdirSync(papersDir, { recursive: true });
  }

  // 如果已经下载过了就跳过
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
    execSync(cmd, {
      encoding: 'utf-8',
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024
    });

    const stats = fs.statSync(pdfPath);
    if (stats.size < 10000) {
      console.error(`  ⚠️ PDF 太小 (${stats.size} bytes)，可能下载失败`);
      fs.unlinkSync(pdfPath);
      return null;
    }
    console.log(`  ✅ PDF 已下载: ${pdfPath} (${(stats.size / 1024).toFixed(1)} KB)`);
    return pdfPath;
  } catch (error) {
    console.error(`  ⚠️ 下载 PDF 失败: ${error.message}`);
    return null;
  }
}

/**
 * 下载论文 HTML 并提取纯文本（备选，当 PDF 下载失败时使用）
 */
async function downloadPaperText(arxivId) {
  const paperFile = `/tmp/paper-${arxivId}.txt`;
  const arxivUrl = `https://arxiv.org/html/${arxivId}`;

  // curl 抓取 arXiv HTML 并去除标签（走代理）
  console.log(`  📥 下载论文全文 ${arxivId} (curl)...`);
  try {
    const cmd = `NODE_OPTIONS='--require ${CONFIG.proxyPatch}' curl -sL "${arxivUrl}" | sed 's/<[^>]*>//g' | sed '/^[[:space:]]*$/d' > ${paperFile}`;
    execSync(cmd, {
      encoding: 'utf-8',
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024
    });
    const stats = fs.statSync(paperFile);
    if (stats.size < 500) {
      console.error(`  ⚠️ 论文全文太小 (${stats.size} bytes)，可能下载失败`);
      return null;
    }
    console.log(`  ✅ 论文全文已下载 (${(stats.size / 1024).toFixed(1)} KB)`);
    return paperFile;
  } catch (error) {
    console.error(`  ⚠️ 下载论文全文失败: ${error.message}`);
    return null;
  }
}

/**
 * 使用 Gemini CLI 写长文（主方案）
 */
async function generateReviewWithGemini(arxivId, title, today, paperFile, model = 'gemini-3.1-pro-preview') {
  const reviewPath = `/home/useradmin/agent_workspace/data/paper-reviews/${today}/${arxivId}.md`;
  const reviewDir = path.dirname(reviewPath);

  // 确保目录存在
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

  console.log(`  💎 Gemini writing review for ${arxivId}...`);

  try {
    const taskFile = `/tmp/gemini-task-${arxivId}.txt`;
    fs.writeFileSync(taskFile, task, 'utf-8');

    // 注意：不要给 Gemini CLI 加 NODE_OPTIONS 代理补丁（会导致卡死）
    const cmd = `gemini -y -m ${model} -p "$(cat ${taskFile})"`;  

    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 600000,  // 10 分钟超时
      maxBuffer: 10 * 1024 * 1024,
      cwd: reviewDir    // 工作目录设为 review 目录
    });

    // 清理临时文件
    try { fs.unlinkSync(taskFile); } catch (e) {}

    // 检查文件是否生成且内容足够（>500字节，避免空文件/占位符）
    const MIN_REVIEW_SIZE = 500;
    if (fs.existsSync(reviewPath)) {
      const fileSize = fs.statSync(reviewPath).size;
      if (fileSize >= MIN_REVIEW_SIZE) {
        console.log(`  ✅ Gemini completed: ${arxivId} (${(fileSize / 1024).toFixed(1)} KB)`);
        return { arxivId, success: true, result, method: 'gemini' };
      } else {
        console.error(`  ⚠️ Gemini wrote too-small file: ${fileSize} bytes, deleting...`);
        try { fs.unlinkSync(reviewPath); } catch (e) {}
      }
    }
    // 文件不存在或太小，尝试从输出中提取
    console.log(`  ⚠️ File missing or too small, trying to extract from output...`);
    const content = extractReviewContent(result);
    if (content && content.length > MIN_REVIEW_SIZE) {
      fs.writeFileSync(reviewPath, content, 'utf-8');
      console.log(`  ✅ Extracted and saved: ${arxivId} (${(content.length / 1024).toFixed(1)} KB)`);
      return { arxivId, success: true, method: 'gemini' };
    }
    console.error(`  ⚠️ Gemini no valid review content for ${arxivId}, will fallback`);
    return { arxivId, success: false, error: 'No review content', method: 'gemini' };

  } catch (error) {
    // 超时检查
    const MIN_REVIEW_SIZE = 500;
    if (error.status === null || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
      console.log(`  ⏰ Gemini timeout, checking file...`);
      if (fs.existsSync(reviewPath)) {
        const fileSize = fs.statSync(reviewPath).size;
        if (fileSize >= MIN_REVIEW_SIZE) {
          console.log(`  ✅ File exists despite timeout: ${arxivId} (${(fileSize / 1024).toFixed(1)} KB)`);
          return { arxivId, success: true, method: 'gemini' };
        } else {
          console.error(`  ⚠️ Timeout but file too small (${fileSize} bytes), deleting...`);
          try { fs.unlinkSync(reviewPath); } catch (e) {}
        }
      }
    }
    console.error(`  ⚠️ Gemini failed for ${arxivId}: ${error.message}`);
    return { arxivId, success: false, error: error.message, method: 'gemini' };
  }
}

/**
 * 使用 Claude CLI 写长文（备选方案）
 */
async function generateReviewWithClaude(arxivId, title, today, paperFile) {
  const reviewPath = `/home/useradmin/agent_workspace/data/paper-reviews/${today}/${arxivId}.md`;
  const reviewDir = path.dirname(reviewPath);

  if (!fs.existsSync(reviewDir)) {
    fs.mkdirSync(reviewDir, { recursive: true });
  }

  let paperContent = '';
  try {
    paperContent = fs.readFileSync(paperFile, 'utf-8');
  } catch (e) {
    console.error(`  ⚠️ 读取论文全文失败: ${e.message}`);
  }

  const taskFile = `/tmp/claude-review-${arxivId}-${Date.now()}.txt`;
  const task = `请分析这篇 arXiv 论文并写一篇详细的中文长文（1500-2000字）。

论文全文：
${paperContent}


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

  console.log(`  🤍 Claude fallback writing review for ${arxivId}...`);

  try {
    fs.writeFileSync(taskFile, task, 'utf-8');
    const cmd = `cat "${taskFile}" | claude -p --model opus --bare --no-session-persistence --tools ""`;

    const content = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024
    });

    if (content && content.length > 500) {
      const reviewContent = extractReviewContent(content);
      if (reviewContent.length >= 500) {
        fs.writeFileSync(reviewPath, reviewContent, 'utf-8');
        console.log(`  ✅ Claude fallback completed: ${arxivId} (${(reviewContent.length / 1024).toFixed(1)} KB)`);
        return { arxivId, success: true, method: 'claude' };
      } else {
        console.error(`  ❌ Claude fallback: extracted content too short (${reviewContent.length} chars) for ${arxivId}`);
      }
    } else {
      console.error(`  ❌ Claude fallback: empty or too short content (${content?.length || 0} chars) for ${arxivId}`);
    }
    return { arxivId, success: false, error: 'claude empty content', method: 'claude' };

  } catch (error) {
    console.error(`  ❌ Claude fallback failed for ${arxivId}: ${error.message}`);
    return { arxivId, success: false, error: error.message, method: 'claude' };
  } finally {
    try { fs.unlinkSync(taskFile); } catch (e) {}
  }
}

/**
 * 写长文：先下载 PDF，再尝试 Gemini，失败后 fallback 到 Claude
 */
async function spawnAgentForPaper(arxivId, title, today) {
  // 1. 下载 PDF
  const pdfPath = downloadPaperPDF(arxivId, today);

  // 2a. Gemini pro + PDF
  if (pdfPath) {
    console.log(`  💎 gemini-3.1-pro-preview 读取 PDF 写长文...`);
    const result = await generateReviewWithGemini(arxivId, title, today, pdfPath, 'gemini-3.1-pro-preview');
    if (result.success) return result;
    console.log(`  🔄 Pro PDF 失败，尝试 Flash PDF...`);

    // 2b. Gemini flash + PDF
    const flashResult = await generateReviewWithGemini(arxivId, title, today, pdfPath, 'gemini-3-flash-preview');
    if (flashResult.success) return flashResult;
    console.log(`  🔄 Flash PDF 也失败，尝试 HTML fallback...`);
  }

  // 3. 下载 HTML text
  const paperFile = await downloadPaperText(arxivId);
  if (paperFile) {
    // 3b. Gemini flash + HTML
    console.log(`  🔄 尝试 Flash HTML...`);
    const flashResult = await generateReviewWithGemini(arxivId, title, today, paperFile, 'gemini-3-flash-preview');
    if (flashResult.success) return flashResult;
    console.log(`  🔄 Flash HTML 也失败，切换到 Claude fallback...`);
  } else {
    console.log(`  🔄 PDF 和 HTML 都失败，切换到 Claude fallback...`);
  }

  // 4. 最终 fallback 到 Claude CLI
  const claudeResult = await generateReviewWithClaude(arxivId, title, today, paperFile || `/tmp/paper-${arxivId}.txt`);
  return claudeResult;
}

/**
 * 从 Gemini 输出中提取论文长文内容
 */
function extractReviewContent(output) {
  // 尝试提取 Markdown 格式的长文（以 # 或 ## 开头的内容块）
  const lines = output.split('\n');
  let contentStarted = false;
  let content = [];

  for (const line of lines) {
    if (!contentStarted && (line.startsWith('# ') || line.startsWith('## '))) {
      contentStarted = true;
    }
    if (contentStarted) {
      content.push(line);
    }
  }

  if (content.length > 0) {
    return content.join('\n').trim();
  }
  return output.trim();
}

/**
 * 推送长文到 Telegram
 */
async function pushToTelegram(arxivId, title, today) {
  const reviewDir = `/home/useradmin/agent_workspace/data/paper-reviews/${today}`;
  let reviewPath = `${reviewDir}/${arxivId}.md`;

  // 如果精确文件名不存在，尝试模糊匹配
  if (!fs.existsSync(reviewPath)) {
    const files = fs.readdirSync(reviewDir).filter(f => f.startsWith(arxivId) && f.endsWith('.md'));
    if (files.length > 0) {
      reviewPath = `${reviewDir}/${files[0]}`;
      console.log(`  ℹ️  使用模糊匹配: ${files[0]}`);
    } else {
      console.log(`  ⚠️  长文未生成: ${arxivId}`);
      return false;
    }
  }

  const content = fs.readFileSync(reviewPath, 'utf-8');

  // 添加标题
  const fullContent = `📄 **${title}**\n\n${content}`;

  // 分段发送（Telegram 限制 4096 字符，留余量用 3500）
  const MAX_CHUNK = 3500;
  const chunks = [];
  if (fullContent.length > MAX_CHUNK) {
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
  } else {
    chunks.push(fullContent);
  }

  // 使用 tg-send.sh 发送到 Telegram
  try {
    let sentCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const tempFile = `/tmp/review-${arxivId}-${i}-${Date.now()}.txt`;
      fs.writeFileSync(tempFile, chunk, 'utf-8');

      // 用 bash 读取文件内容传给 -m
      const cmd = `/home/useradmin/agent_workspace/scripts/tg-send.sh 5740650457 --file ${tempFile}`;
      execSync(cmd, { encoding: 'utf-8', timeout: 15000 });

      fs.unlinkSync(tempFile); // 删除临时文件
      sentCount++;

      // 避免发送太快
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    console.log(`  ✅ 已推送 ${sentCount} 段消息`);
    return true;

  } catch (error) {
    console.error(`  ❌ 推送失败: ${error.message}`);
    return false;
  }
}

/**
 * Spawn sub-agents 并等待长文生成
 */
async function spawnAndWaitForReviews(papers) {
  const today = new Date().toISOString().slice(0, 10);
  const reviewDir = `/home/useradmin/agent_workspace/data/paper-reviews/${today}`;
  
  // 创建长文目录
  if (!fs.existsSync(reviewDir)) {
    fs.mkdirSync(reviewDir, { recursive: true });
    console.log(`📁 创建长文目录: ${reviewDir}\n`);
  }
  
  console.log(`💎 开始用 Gemini 写 ${papers.length} 篇长文...\n`);
  
  // 为每篇论文 spawn agent
  const spawnResults = [];
  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    console.log(`[${i + 1}/${papers.length}] ${paper.arxiv_id} - ${paper.title.substring(0, 50)}...`);
    
    try {
      const result = await spawnAgentForPaper(paper.arxiv_id, paper.title, today);
      spawnResults.push(result);
    } catch (error) {
      console.error(`  ❌ Gemini 失败:`, error.message);
      spawnResults.push({ arxivId: paper.arxiv_id, success: false });
    }
  }
  
  const successCount = spawnResults.filter(r => r.success).length;
  console.log(`\n📊 Spawn 结果: ${successCount}/${spawnResults.length} 成功`);

  // 清理 reviewDir 中 Gemini 可能残留的 PDF
  try {
    const strayPdfs = fs.readdirSync(reviewDir).filter(f => f.endsWith('.pdf'));
    for (const pdf of strayPdfs) {
      fs.unlinkSync(path.join(reviewDir, pdf));
      console.log(`🧹 清理残留 PDF: ${pdf}`);
    }
  } catch (e) {}

  // 清理超长垃圾 md（Gemini 发癫时会生成几千行提示词垃圾）
  const MAX_REVIEW_LINES = 500;
  try {
    const mdFiles = fs.readdirSync(reviewDir).filter(f => f.endsWith('.md'));
    for (const md of mdFiles) {
      const mdPath = path.join(reviewDir, md);
      const lines = fs.readFileSync(mdPath, 'utf-8').split('\n').length;
      if (lines > MAX_REVIEW_LINES) {
        fs.unlinkSync(mdPath);
        console.log(`🧹 清理超长垃圾 md: ${md} (${lines} 行)`);
        // 标记对应 spawnResult 为失败，避免推送垃圾
        const arxivId = md.replace('.md', '');
        const sr = spawnResults.find(r => r.arxivId === arxivId);
        if (sr) sr.success = false;
      }
    }
  } catch (e) {}

  // 推送长文
  console.log(`\n📤 开始推送长文到 Telegram...\n`);
  const pushResults = [];
  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    const spawnResult = spawnResults[i];
    
    if (spawnResult.success) {
      console.log(`[${i + 1}/${papers.length}] 推送 ${paper.arxiv_id}...`);
      const pushResult = await pushToTelegram(paper.arxiv_id, paper.title, today);
      pushResults.push({ arxivId: paper.arxiv_id, success: pushResult });
    } else {
      pushResults.push({ arxivId: paper.arxiv_id, success: false });
    }
  }
  
  const pushSuccessCount = pushResults.filter(r => r.success).length;
  console.log(`\n📊 推送结果: ${pushSuccessCount}/${pushResults.length} 成功`);
  
  return spawnResults.map((r, i) => ({
    ...r,
    pushed: pushResults[i].success
  }));
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 正在获取 AlphaXiv 热门论文...\n');
  
  // 1. 获取页面
  const html = await fetchAlphaXiv();
  if (!html) {
    console.error('❌ 获取页面失败');
    process.exit(1);
  }
  console.log(`✅ 获取到 ${(html.length / 1024).toFixed(1)} KB 的 HTML\n`);
  
  // 2. 解析论文
  const papers = parsePapers(html);
  console.log(`📋 解析到 ${papers.length} 篇论文\n`);
  
  if (papers.length === 0) {
    console.log('⚠️  没有解析到论文，尝试调试...');
    console.log('HTML 片段:', html.substring(0, 500));
    process.exit(1);
  }
  
  // 3. 筛选和排序
  const sortedPapers = filterAndSort(papers);
  console.log(`📊 筛选出 ${sortedPapers.length} 篇热门论文 (点赞 ≥ ${CONFIG.minLikes})`);
  
  // 4. 加载历史记录并去重
  const history = loadHistory();
  const newPapers = deduplicate(sortedPapers, history);
  console.log(`🔄 去重后剩余 ${newPapers.length} 篇新论文 (历史记录: ${history.pushed.length} 篇)\n`);
  
  // 5. 取 Top N（有多少推多少）
  const topPapers = newPapers.slice(0, CONFIG.maxPapers);
  
  if (topPapers.length === 0) {
    // 没有新论文时，生成一条简要提醒并退出
    const date = new Date().toLocaleDateString('zh-CN', { 
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
    const noNewReport = `📭 **AlphaXiv 今日热门**\n📅 ${date}\n\n今天没有新的热门论文上榜，榜单与昨日基本一致。\n\n🏆 当前榜单 Top 3:\n${sortedPapers.slice(0, 3).map((p, i) => `${['🥇','🥈','🥉'][i]} ${p.title} (${p.likes}👍)`).join('\n')}\n\n📎 查看完整榜单: https://alphaxiv.org/explore?sort=Hot`;
    
    fs.writeFileSync(CONFIG.outputPath, noNewReport, 'utf-8');
    console.log('📭 今天没有新的热门论文');
    console.log('\n' + '='.repeat(60));
    console.log(noNewReport);
    console.log('='.repeat(60));
    
    // 仍然保存历史（不更新）
    process.exit(0);
  }
  
  console.log(`🏆 将推送 Top ${topPapers.length} 新论文:\n`);
  
  topPapers.forEach((p, i) => {
    const title = p.title.length > 50 ? p.title.substring(0, 50) + '...' : p.title;
    console.log(`${i + 1}. 👍 ${p.likes.toString().padStart(3)} | 👁 ${p.views.toString().padStart(5)} | ${title}`);
  });
  
  // 6. 获取论文详细信息并生成评论
  console.log(`\n📝 正在获取论文详情并生成评论...\n`);
  for (let i = 0; i < topPapers.length; i++) {
    const paper = topPapers[i];
    console.log(`  [${i + 1}/${topPapers.length}] ${paper.arxiv_id}...`);
    
    // 获取论文信息
    const info = await fetchPaperInfo(paper.arxiv_id);
    paper.authors = info.authors;
    paper.institution = info.institution;
    paper.abstract = info.abstract;
    
    // 生成评论
    paper.comment = await generateComment(paper);
    console.log(`    ✅ 完成`);
  }
  
  // 7. 生成报告
  const report = generateReport(topPapers);
  
  // 8. 保存报告
  const outputDir = path.dirname(CONFIG.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(CONFIG.outputPath, report, 'utf-8');
  console.log(`\n📄 报告已保存: ${CONFIG.outputPath}`);

  // 8.1 保存带日期的备份
  const today = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(CONFIG.backupDir, `alphaxiv-${today}.md`);
  if (!fs.existsSync(CONFIG.backupDir)) {
    fs.mkdirSync(CONFIG.backupDir, { recursive: true });
  }
  fs.writeFileSync(backupPath, report, 'utf-8');
  console.log(`📦 备份已保存: ${backupPath}`);
  
  // 9. 更新并保存历史记录
  updateHistory(history, topPapers);
  saveHistory(history);
  console.log(`📝 历史记录已更新 (共 ${history.pushed.length} 篇)`);
  
  // 10. 输出报告
  console.log('\n' + '='.repeat(60));
  console.log(report);
  console.log('='.repeat(60));
  
  // 10.1 推送简报到 Telegram
  console.log('\n📤 推送简报到 Telegram...');
  try {
    const tempFile = `/tmp/alphaxiv-daily-${Date.now()}.txt`;
    fs.writeFileSync(tempFile, report, 'utf-8');
    // 用 bash 读取文件内容传给 -m
    execSync(`/home/useradmin/agent_workspace/scripts/tg-send.sh 5740650457 --file ${tempFile}`, {
      encoding: 'utf-8',
      timeout: 10000
    });
    fs.unlinkSync(tempFile);
    console.log('✅ 简报已推送到 Telegram');
  } catch (error) {
    console.error('❌ 推送简报失败:', error.message);
  }
  
  // 11. 用 Gemini 写长文
  console.log('\n' + '='.repeat(60));
  console.log('💎 Gemini 长文生成流程启动');
  console.log('='.repeat(60) + '\n');
  
  try {
    const results = await spawnAndWaitForReviews(topPapers);
    
    const successCount = results.filter(r => r.success).length;
    console.log(`\n📊 长文生成结果: ${successCount}/${results.length} 成功`);
    
    if (successCount === results.length) {
      console.log(`\n✅ 所有长文已生成并推送到 Telegram`);
    } else {
      console.log(`\n⚠️  部分长文生成失败，请检查日志`);
    }
    
  } catch (error) {
    console.error('\n❌ Gemini 写长文失败:', error.message);
    console.log('💡 提示：简化版报告已推送，长文需要手动生成');
  }
  
  // 12. 清理半年前的 PDF（只清 papers 目录，保留 paper-reviews 等）
  cleanOldPapers();

  return { papers: topPapers, report };
}

/**
 * 清理超过 180 天的 papers 目录（PDF 太大，只保留半年）
 */
function cleanOldPapers() {
  const papersBase = '/home/useradmin/agent_workspace/data/papers';
  try {
    if (!fs.existsSync(papersBase)) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const dirs = fs.readdirSync(papersBase).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoffStr);
    for (const dir of dirs) {
      const dirPath = path.join(papersBase, dir);
      const files = fs.readdirSync(dirPath);
      for (const f of files) {
        fs.unlinkSync(path.join(dirPath, f));
      }
      fs.rmdirSync(dirPath);
      console.log(`🧹 清理过期 PDF 目录: ${dir}`);
    }
  } catch (e) {
    console.error('⚠️ 清理旧 PDF 失败:', e.message);
  }
}

// 运行
if (require.main === module) {
  main().catch(err => {
    console.error('❌ 执行失败:', err);
    process.exit(1);
  });
}

module.exports = { fetchAlphaXiv, parsePapers, filterAndSort, generateReport };
