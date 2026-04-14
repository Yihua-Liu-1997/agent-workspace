#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const cheerio = require('cheerio');

// 加载代理补丁（让 fetch 走代理）
require(path.resolve(__dirname, '../../../fetch-patch.cjs'));

/**
 * GitHub Trending 热门项目推送系统
 * 每日抓取 GitHub Trending 页面，筛选热门项目，AI 分类评论后推送到 Telegram
 *
 * 数据源：
 *   - https://github.com/trending?since=daily        (全语种)
 *   - https://github.com/trending/python?since=daily  (Python)
 *   - https://github.com/trending/typescript?since=daily (TypeScript)
 */

// ────────────────────────────────────────────
// 配置
// ────────────────────────────────────────────
const WORKSPACE_DIR = path.resolve(__dirname, '..');

const CONFIG = {
  // 抓取源
  sources: [
    'https://github.com/trending?since=daily',
    'https://github.com/trending/python?since=daily',
    'https://github.com/trending/typescript?since=daily',
  ],
  // 筛选
  maxProjects: 5,
  minStarsToday: 50,
  cooldownDays: 7,
  // 网络
  timeout: 30000,
  proxyPatch: path.resolve(__dirname, '../../../fetch-patch.cjs'),
  // 智谱 AI
  zhipuApiKey: 'f6efdb78d38248ccaa04e504d8615469.UFCOZXA1JxTPRNyK',
  zhipuBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  zhipuModel: 'glm-5.1',
  aiConcurrency: 1,
  // 存储
  workspaceDir: WORKSPACE_DIR,
  outputPath: path.join(WORKSPACE_DIR, 'data/github-trending-daily.md'),
  archiveDir: path.join(WORKSPACE_DIR, 'data/github-trending-archives'),
  historyPath: path.join(WORKSPACE_DIR, 'data/github-trending-history.json'),
  reviewDir: path.join(WORKSPACE_DIR, 'data/project-reviews'),
  // 推送
  telegramTarget: '5740650457',
};

// ────────────────────────────────────────────
// 工具函数
// ────────────────────────────────────────────

const delay = ms => new Promise(res => setTimeout(res, ms));

async function parallelWithLimit(tasks, limit = CONFIG.aiConcurrency) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r; });
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * 解析带逗号的数字字符串 → 数字
 */
function parseNumber(str) {
  if (!str) return 0;
  return parseInt(str.replace(/[^0-9]/g, ''), 10) || 0;
}

/**
 * 获取今天日期字符串 (Asia/Shanghai)
 */
function getToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

/**
 * 获取友好日期
 */
function getFriendlyDate() {
  return new Date().toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ────────────────────────────────────────────
// 数据抓取
// ────────────────────────────────────────────

/**
 * 抓取单个 GitHub Trending 页面 HTML
 */
async function fetchTrendingPage(url) {
  console.log(`  📡 抓取: ${url}`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    console.log(`  ✅ 获取到 ${(html.length / 1024).toFixed(1)} KB (${url})`);
    return html;
  } catch (error) {
    console.error(`  ❌ 抓取失败 (${url}): ${error.message}`);
    return null;
  }
}

/**
 * 抓取所有数据源
 */
async function fetchAllSources() {
  const promises = CONFIG.sources.map(url => fetchTrendingPage(url));
  const results = await Promise.all(promises);
  let allHtml = '';
  for (const html of results) {
    if (html) allHtml += html + '\n';
  }
  return allHtml;
}

// ────────────────────────────────────────────
// HTML 解析
// ────────────────────────────────────────────

/**
 * 从合并的 HTML 中解析所有项目
 */
function parseProjects(html) {
  const projects = [];
  const $ = cheerio.load(html);
  $('article.Box-row').each((i, el) => {
    try {
      const row = $(el);
      const starHref = row.find('a[href$="/stargazers"]').attr('href');
      if (!starHref) return;
      const fullName = starHref.replace(/^\/+/, '').replace(/\/stargazers$/, '').replace(/\/+$/, '');
      if (!fullName.includes('/') || fullName.split('/').length !== 2) return;
      const description = row.find('p.col-9').text().trim();
      const language = row.find('span[itemprop="programmingLanguage"]').text().trim();
      const stars = parseNumber(row.find('a[href$="/stargazers"]').text().trim());
      const forksText = row.find('a[href$="/forks"]').text().trim() || row.find('a[href$="/network/members"]').text().trim();
      const forks = parseNumber(forksText);
      const todayMatch = row.text().match(/([\d,]+)\s*stars?\s*today/i);
      const starsToday = parseNumber(todayMatch ? todayMatch[1] : '0');
      projects.push({ fullName, description, language, stars, forks, starsToday, isAI: false, comment: '' });
    } catch (e) { /* skip */ }
  });
  return projects;
}

/**
 * 按仓库名去重，保留 starsToday 更高的那个
 */
function deduplicateProjects(projects) {
  const map = new Map();
  for (const p of projects) {
    const key = p.fullName.toLowerCase();
    const existing = map.get(key);
    if (!existing || p.starsToday > existing.starsToday) {
      map.set(key, { ...p });
    }
  }
  return [...map.values()];
}

// ────────────────────────────────────────────
// 历史记录 & 冷却机制
// ────────────────────────────────────────────

/**
 * 加载历史记录
 */
function loadHistory() {
  try {
    if (fs.existsSync(CONFIG.historyPath)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.historyPath, 'utf-8'));
      // 清理过期记录
      const cutoff = Date.now() - CONFIG.cooldownDays * 24 * 60 * 60 * 1000;
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
    ensureDir(path.dirname(CONFIG.historyPath));
    fs.writeFileSync(CONFIG.historyPath, JSON.stringify(history, null, 2), 'utf-8');
  } catch (e) {
    console.error('⚠️  保存历史记录失败:', e.message);
  }
}

/**
 * 过滤冷却期内的项目（7 天内推送过的排除）
 */
function filterCooldown(projects, history) {
  const now = Date.now();
  const cooldownMs = CONFIG.cooldownDays * 24 * 60 * 60 * 1000;
  const recentSet = new Set(
    history.pushed
      .filter(item => now - item.date < cooldownMs)
      .map(item => item.fullName.toLowerCase())
  );
  return projects.filter(p => !recentSet.has(p.fullName.toLowerCase()));
}

/**
 * 更新历史记录
 */
function updateHistory(history, projects) {
  const now = Date.now();
  for (const p of projects) {
    history.pushed.push({
      fullName: p.fullName,
      date: now,
    });
  }
  // 清理过期记录
  const cutoff = now - CONFIG.cooldownDays * 24 * 60 * 60 * 1000;
  history.pushed = history.pushed.filter(item => item.date > cutoff);
  return history;
}

// ────────────────────────────────────────────
// AI 分类与评论（智谱 API）
// ────────────────────────────────────────────

/**
 * 调用智谱 API（通用）
 */
async function callZhipuAPI(messages, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const payload = {
        model: CONFIG.zhipuModel,
        messages,
        max_tokens: 1000,
        temperature: 0.7,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(`${CONFIG.zhipuBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.zhipuApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      // 1305: 过载，重试
      if (data.error?.code === '1305') {
        console.error(`  ⚠️  智谱 API 限流 (1305)，第 ${attempt}/${maxRetries} 次重试...`);
        if (attempt < maxRetries) {
          await delay(attempt * 3000);
          continue;
        }
        return null;
      }

      if (!response.ok) {
        console.error(`  ⚠️  智谱 API HTTP 错误: ${response.status}`);
        return null;
      }

      return data.choices?.[0]?.message?.content || null;
    } catch (error) {
      console.error(`  ⚠️  智谱 API 调用失败: ${error.message}`);
      return null;
    }
  }
}

/**
 * AI 分类：判断项目是否是 AI/ML/LLM 相关
 */
async function classifyProject(project) {
  const prompt = `判断以下 GitHub 项目是否与 AI/ML/LLM（人工智能/机器学习/大语言模型）相关。

项目名: ${project.fullName}
描述: ${project.description || '无描述'}
主语言: ${project.language || '未知'}

只回答 YES 或 NO，不要其他内容。`;

  const result = await callZhipuAPI([{ role: 'user', content: prompt }], 2);
  if (!result) return false;
  return result.trim().toUpperCase().startsWith('YES');
}

/**
 * AI 生成 150 字左右简评
 */
async function generateComment(project) {
  const prompt = `你是技术博主，请为以下 GitHub 热门项目写一段 150 字左右的中文简评。

项目名: ${project.fullName}
描述: ${project.description || '无描述'}
主语言: ${project.language || '未知'}
⭐ ${project.stars.toLocaleString()} stars | 📈 +${project.starsToday.toLocaleString()} today | 🍴 ${project.forks.toLocaleString()} forks

要求：
1. 一句话说明项目是做什么的
2. 点评其技术亮点或实用价值
3. 语气自然、有趣，像朋友推荐
4. 不要用标题或列表格式

直接输出评论内容，不要加前缀：`;

  const result = await callZhipuAPI([{ role: 'user', content: prompt }]);
  return result || '💡 值得关注的热门项目，建议点击链接查看详情。';
}

/**
 * 对项目列表做 AI 分类 + 评论
 */
async function processWithAI(projects) {
  console.log(`\n🤖 开始 AI 分类与评论 (${projects.length} 个项目)...\n`);

  const tasks = projects.map((p, i) => async () => {
    console.log(`  [${i + 1}/${projects.length}] 开始处理: ${p.fullName}`);

    // 分类
    p.isAI = await classifyProject(p);
    console.log(`    [${i + 1}] ${p.isAI ? '🧠 AI相关' : '📦 通用'} - ${p.fullName}`);

    // 生成评论
    p.comment = await generateComment(p);
    console.log(`    [${i + 1}] ✅ 评论已生成 - ${p.fullName}`);

    return p;
  });

  await parallelWithLimit(tasks);
  return projects;
}

// ────────────────────────────────────────────
// 报告生成
// ────────────────────────────────────────────

/**
 * 生成 Markdown 格式的每日报告
 */
function generateReport(projects) {
  const date = getFriendlyDate();
  const today = getToday();

  if (projects.length === 0) {
    return `📭 **GitHub 今日热门项目**\n📅 ${date}\n\n今天没有找到符合条件的新项目 (今日新增 star ≥ ${CONFIG.minStarsToday})`;
  }

  // AI 项目置顶
  const aiProjects = projects.filter(p => p.isAI);
  const otherProjects = projects.filter(p => !p.isAI);
  const sorted = [...aiProjects, ...otherProjects];

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  let report = `🚀 **GitHub 今日热门项目**\n`;
  report += `📅 ${date}\n\n`;
  report += `---\n\n`;

  sorted.forEach((p, i) => {
    const medal = medals[i] || `${i + 1}.`;
    const aiTag = p.isAI ? ' 🧠' : '';

    report += `${medal} **[${p.fullName}](https://github.com/${p.fullName})**${aiTag}\n`;
    report += `   ⭐ ${p.stars.toLocaleString()} | 📈 +${p.starsToday.toLocaleString()} today | 🍴 ${p.forks.toLocaleString()}`;
    if (p.language) report += ` | 🛠 ${p.language}`;
    report += `\n`;

    if (p.description) {
      const shortDesc = p.description.length > 120
        ? p.description.substring(0, 117) + '...'
        : p.description;
      report += `   📝 ${shortDesc}\n`;
    }

    if (p.comment) {
      report += `   💭 ${p.comment}\n`;
    }

    report += `\n`;
  });

  report += `---\n`;
  report += `_数据来源: GitHub Trending | 分类与评论由 AI 生成_`;

  return report;
}

// ────────────────────────────────────────────
// 长文生成（Gemini CLI）
// ────────────────────────────────────────────

/**
 * 验证 Markdown 内容是否有效
 */
function isValidMarkdown(content) {
  if (!content) return false;
  const hasHeading = content.includes('# ') || content.includes('## ');
  const nonWhitespaceLength = content.replace(/\s/g, '').length;
  return hasHeading || nonWhitespaceLength >= 500;
}

/**
 * 使用 Gemini CLI 为项目生成长文分析
 */
function generateReviewWithGemini(project, today) {
  const reviewDir = `${CONFIG.reviewDir}/${today}`;
  ensureDir(reviewDir);

  const safeName = project.fullName.replace(/\//g, '__');
  const reviewPath = `${reviewDir}/${safeName}.md`;

  // 已经生成过就跳过
  if (fs.existsSync(reviewPath)) {
    const content = fs.readFileSync(reviewPath, 'utf-8');
    if (isValidMarkdown(content)) {
      console.log(`  ✅ 长文已存在且有效: ${reviewPath} (${(content.length / 1024).toFixed(1)} KB)`);
      return { fullName: project.fullName, success: true, method: 'gemini', path: reviewPath };
    }
  }

  const task = `请分析以下 GitHub 热门项目并写一篇详细的中文技术分析长文。

项目地址: https://github.com/${project.fullName}
项目描述: ${project.description || '无描述'}
主语言: ${project.language || '未知'}
Stars: ${project.stars.toLocaleString()} | 今日新增: +${project.starsToday.toLocaleString()} | Forks: ${project.forks.toLocaleString()}

请先搜索该项目获取更多上下文信息，然后访问项目 GitHub 页面。

要求：
1. 搜索项目的相关内容，整合信息
2. 仔细阅读项目 README 和文档
3. 长文必须包含以下章节：
   - 标题（项目名 + 一句话概括）
   - 项目简介（做什么的、解决什么问题）
   - 核心特性与技术架构
   - 适用场景与目标用户
   - 与同类项目对比
   - 评价与思考（个人见解，要有深度）
   - 上手建议
4. 用 Markdown 格式
5. 最后写完后，将完整长文保存到文件：${reviewPath}

重要：一定要把完整内容写入 ${reviewPath} 文件！`;

  console.log(`  💎 Gemini 写长文: ${project.fullName}...`);

  try {
    const taskFile = path.join(__dirname, `gemini-task-${safeName}.txt`);
    fs.writeFileSync(taskFile, task, 'utf-8');

    // 注意：不要给 Gemini CLI 加 NODE_OPTIONS 代理补丁（会导致卡死）
    // 修复了命令注入，使用 execFileSync 并将 task 直接作为参数传入，取代 "$(cat file)" 的高危做法
    const result = execFileSync('gemini', ['-y', '-m', 'gemini-3.1-pro-preview', '-p', task], {
      encoding: 'utf-8',
      timeout: 600000, // 10 分钟
      maxBuffer: 10 * 1024 * 1024,
      cwd: reviewDir,
    });

    try { fs.unlinkSync(taskFile); } catch (e) {}

    if (fs.existsSync(reviewPath)) {
      const content = fs.readFileSync(reviewPath, 'utf-8');
      if (isValidMarkdown(content)) {
        console.log(`  ✅ Gemini 完成: ${project.fullName} (${(content.length / 1024).toFixed(1)} KB)`);
        return { fullName: project.fullName, success: true, method: 'gemini', path: reviewPath };
      }
      console.error(`  ⚠️ Gemini 文件内容不合规 (${content.length} bytes)，删除...`);
      try { fs.unlinkSync(reviewPath); } catch (e) {}
    }

    // 尝试从输出中提取
    const content = extractReviewContent(result);
    if (isValidMarkdown(content)) {
      fs.writeFileSync(reviewPath, content, 'utf-8');
      console.log(`  ✅ 从输出提取并保存: ${project.fullName} (${(content.length / 1024).toFixed(1)} KB)`);
      return { fullName: project.fullName, success: true, method: 'gemini', path: reviewPath };
    }

    console.error(`  ⚠️ Gemini 未能生成有效长文: ${project.fullName}`);
    return { fullName: project.fullName, success: false };

  } catch (error) {
    // 超时但文件可能已写入
    const taskFile = path.join(__dirname, `gemini-task-${safeName}.txt`);
    try { fs.unlinkSync(taskFile); } catch (e) {}
    
    if (fs.existsSync(reviewPath)) {
      const content = fs.readFileSync(reviewPath, 'utf-8');
      if (isValidMarkdown(content)) {
        console.log(`  ✅ 超时但文件有效: ${project.fullName} (${(content.length / 1024).toFixed(1)} KB)`);
        return { fullName: project.fullName, success: true, method: 'gemini', path: reviewPath };
      }
      try { fs.unlinkSync(reviewPath); } catch (e) {}
    }
    console.error(`  ⚠️ Gemini 失败: ${project.fullName} - ${error.message}`);
    return { fullName: project.fullName, success: false, error: error.message };
  }
}

/**
 * 从 Gemini 输出中提取 Markdown 长文
 */
function extractReviewContent(output) {
  const lines = output.split('\n');
  let contentStarted = false;
  const content = [];

  for (const line of lines) {
    if (!contentStarted && (line.startsWith('# ') || line.startsWith('## '))) {
      contentStarted = true;
    }
    if (contentStarted) {
      content.push(line);
    }
  }

  return content.length > 0 ? content.join('\n').trim() : output.trim();
}

// ────────────────────────────────────────────
// 推送到 Telegram
// ────────────────────────────────────────────

/**
 * 推送简报到 Telegram
 */
function pushSummaryToTelegram(report) {
  console.log('\n📤 推送简报到 Telegram...');
  try {
    execFileSync('bash', [
      
      
      '/home/useradmin/agent_workspace/scripts/tg-send.sh', CONFIG.telegramTarget
    ], { input: report, encoding: 'utf-8', timeout: 15000 });
    console.log('✅ 简报已推送到 Telegram');
    return true;
  } catch (error) {
    console.error('❌ 推送简报失败:', error.message);
    return false;
  }
}

/**
 * 推送长文到 Telegram（分段发送）
 */
async function pushReviewToTelegram(project, reviewPath) {
  if (!fs.existsSync(reviewPath)) {
    console.log(`  ⚠️  长文文件不存在: ${reviewPath}`);
    return false;
  }

  const content = fs.readFileSync(reviewPath, 'utf-8');
  const fullContent = `📄 **${project.fullName}** - 技术深度分析\n\n${content}`;

  // Telegram 限制 4096 字符，留余量用 3500
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

  try {
    let sentCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      execFileSync('bash', [
        
        
        '/home/useradmin/agent_workspace/scripts/tg-send.sh', CONFIG.telegramTarget
      ], { input: chunk, encoding: 'utf-8', timeout: 15000 });

      sentCount++;

      // 避免发送太快
      if (i < chunks.length - 1) {
        await delay(1500);
      }
    }

    console.log(`  ✅ 已推送 ${sentCount} 段长文消息`);
    return true;
  } catch (error) {
    console.error(`  ❌ 推送长文失败: ${error.message}`);
    return false;
  }
}

// ────────────────────────────────────────────
// 主流程
// ────────────────────────────────────────────

async function main() {
  console.log('🚀 GitHub Trending 每日推送启动\n');
  console.log('='.repeat(60));

  // 1. 抓取数据
  console.log('\n📡 第一步：抓取 GitHub Trending 页面\n');
  const html = await fetchAllSources();
  if (!html || html.length < 1000) {
    console.error('❌ 抓取失败，HTML 太少');
    process.exit(1);
  }
  console.log(`\n✅ 共获取 ${(html.length / 1024).toFixed(1)} KB HTML\n`);

  // 2. 解析项目
  console.log('📋 第二步：解析项目列表\n');
  const rawProjects = parseProjects(html);
  console.log(`  解析到 ${rawProjects.length} 个原始项目`);

  // 3. 去重
  const projects = deduplicateProjects(rawProjects);
  console.log(`  去重后 ${projects.length} 个项目\n`);

  if (projects.length === 0) {
    console.log('⚠️  没有解析到项目，退出');
    process.exit(1);
  }

  // 4. 筛选：今日新增 star ≥ minStarsToday
  const filtered = projects.filter(p => p.starsToday >= CONFIG.minStarsToday);
  console.log(`  筛选 stars today ≥ ${CONFIG.minStarsToday}: ${filtered.length} 个\n`);

  // 5. 排序：按今日新增 star 降序
  const sorted = filtered.sort((a, b) => b.starsToday - a.starsToday);

  // 6. 加载历史记录，过滤冷却期内的项目
  const history = loadHistory();
  const newProjects = filterCooldown(sorted, history);
  console.log(`  冷却期过滤后: ${newProjects.length} 个新项目 (历史记录: ${history.pushed.length} 个)\n`);

  // 7. 取 Top N
  const topProjects = newProjects.slice(0, CONFIG.maxProjects);

  if (topProjects.length === 0) {
    console.log('📭 今天没有新的热门项目，跳过推送');
    process.exit(0);
  }

  console.log(`🏆 将推送 Top ${topProjects.length} 个项目:\n`);
  topProjects.forEach((p, i) => {
    console.log(`  ${i + 1}. 📈 +${p.starsToday.toString().padStart(5)} | ⭐ ${p.stars.toLocaleString().padStart(8)} | ${p.fullName}`);
  });

  // 8. AI 分类 + 评论
  await processWithAI(topProjects);

  // 9. 生成报告
  const report = generateReport(topProjects);

  // 10. 保存报告
  ensureDir(path.dirname(CONFIG.outputPath));
  fs.writeFileSync(CONFIG.outputPath, report, 'utf-8');
  console.log(`\n📄 报告已保存: ${CONFIG.outputPath}`);

  // 10.1 保存归档
  const today = getToday();
  ensureDir(CONFIG.archiveDir);
  const archivePath = `${CONFIG.archiveDir}/github-trending-${today}.md`;
  fs.writeFileSync(archivePath, report, 'utf-8');
  console.log(`📦 归档已保存: ${archivePath}`);

  // 11. 更新历史记录
  updateHistory(history, topProjects);
  saveHistory(history);
  console.log(`📝 历史记录已更新 (共 ${history.pushed.length} 个)`);

  // 12. 输出报告
  console.log('\n' + '='.repeat(60));
  console.log(report);
  console.log('='.repeat(60));

  // 13. 推送简报到 Telegram
  pushSummaryToTelegram(report);

  // 14. 用 Gemini 为 Top 1 项目写长文
  const topProject = topProjects[0];
  console.log(`\n💎 为 Top 1 项目生成长文: ${topProject.fullName}\n`);

  try {
    const reviewResult = generateReviewWithGemini(topProject, today);

    if (reviewResult.success && reviewResult.path) {
      console.log(`\n✅ 长文已生成，开始推送到 Telegram...`);
      await pushReviewToTelegram(topProject, reviewResult.path);
    } else {
      console.log(`\n⚠️  长文生成失败，仅推送了简报`);
    }
  } catch (error) {
    console.error(`\n❌ 长文生成失败: ${error.message}`);
    console.log('💡 简报已推送，长文需要手动生成');
  }

  console.log('\n🏁 GitHub Trending 每日推送完成！');
  return { projects: topProjects, report };
}

// 运行
if (require.main === module) {
  main().catch(err => {
    console.error('❌ 执行失败:', err);
    process.exit(1);
  });
}

module.exports = {
  fetchTrendingPage,
  fetchAllSources,
  parseProjects,
  deduplicateProjects,
  loadHistory,
  saveHistory,
  filterCooldown,
  updateHistory,
  classifyProject,
  generateComment,
  processWithAI,
  generateReport,
  generateReviewWithGemini,
  pushSummaryToTelegram,
  pushReviewToTelegram,
};