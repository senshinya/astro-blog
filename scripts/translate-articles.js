/**
 * 自动翻译文章脚本
 *
 * 扫描src/content目录下的所有Markdown文件，检查它们的front matter，
 * 如果lang为zh，则调用OpenAI API翻译全文，并将结果保存为新文件。
 *
 * 使用方法: node scripts/translate-articles.js <目标语言后缀>
 * 例如: node scripts/translate-articles.js en 英文 (将中文文章翻译为英文，并保存为xxx-en.md)
 *
 * 环境变量:
 *   - OPENAI_API_KEY: OpenAI API密钥（必需）
 *   - OPENAI_API_BASE_URL: OpenAI API基础URL（可选，默认为官方API）
 * 
 * 依赖: npm install openai dotenv
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 获取目标语言后缀
const targetLangSuffix = process.argv[2];
if (!targetLangSuffix) {
    console.error('❌ 请提供目标语言后缀，例如: node scripts/translate-articles.js en 英文');
    process.exit(1);
}
const targetLang = process.argv[3];
if (!targetLang) {
    console.error('❌ 请提供目标语言后缀，例如: node scripts/translate-articles.js en 英文');
    process.exit(1);
}

// 初始化OpenAI客户端，支持自定义BaseURL
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_API_BASE_URL, // 如果未设置，将使用默认值
});

// 输出当前使用的BaseURL信息
const baseURL = process.env.OPENAI_API_BASE_URL || '默认OpenAI API URL';
console.log(`🔌 使用OpenAI API BaseURL: ${baseURL}`);

// 分割内容为frontmatter和正文
function splitContent(content) {
    const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/m);
    if (!match) {
        return {
            frontmatter: '',
            body: content,
            hasFrontmatter: false,
        };
    }

    return {
        frontmatter: match[1],
        body: match[2],
        hasFrontmatter: true,
    };
}

// 解析frontmatter
function parseFrontmatter(frontmatter) {
    const lines = frontmatter.split('\n');
    const result = {};
    let currentKey = null;
    let currentValue = [];

    for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
            if (currentKey) {
                result[currentKey] = currentValue.join('\n').trim();
                currentValue = [];
            }
            currentKey = match[1];
            currentValue.push(match[2]);
        } else if (currentKey && line.trim().startsWith('-')) {
            // 处理数组项
            if (!Array.isArray(result[currentKey])) {
                result[currentKey] = [];
            }
            result[currentKey].push(line.trim().substring(1).trim());
        } else if (currentKey) {
            currentValue.push(line);
        }
    }

    if (currentKey) {
        result[currentKey] = currentValue.join('\n').trim();
    }

    return result;
}

// 使用OpenAI翻译文章
async function translateArticle(content) {
    try {
        // 使用Chat Completions API
        const completion = await openai.chat.completions.create({
            model: "gpt-5-mini", // 或者使用其他可用模型
            messages: [
                {
                    role: "system",
                    content: `将这篇 astro 博客从中文翻译到${targetLang}，要求信达雅，保留原汁原味的同时使用地道的${targetLang}表述，只输出翻译结果，不要输出其他内容，注意要带上完整的 frontmatter 翻译。其中 npy 的意思是女朋友`
                },
                {
                    role: "user",
                    content: `${content}`
                }
            ],
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error(`翻译文章时出错: ${error.message}`);
        return '';
    }
}

async function main() {
    console.log('🔍 扫描Markdown文件...');

    // 查找所有Markdown文件
    const files = await fg(['src/content/**/*.md']);
    console.log(`📦 找到 ${files.length} 个Markdown文件`);

    let translatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const file of files) {
        try {
            // 读取文件内容
            const content = await readFile(file, 'utf8');
            const { frontmatter, hasFrontmatter } = splitContent(content);

            // 如果没有frontmatter，跳过
            if (!hasFrontmatter) {
                console.log(`⏩ 跳过 ${file}: 没有frontmatter`);
                skippedCount++;
                continue;
            }

            // 解析frontmatter
            const data = parseFrontmatter(frontmatter);

            // 检查lang是否为zh
            if (data.lang !== 'zh') {
                console.log(`⏩ 跳过 ${file}: 语言不是中文`);
                skippedCount++;
                continue;
            }

            // 检查文件是否已经有对应的翻译版本
            const { dir, name, ext } = parse(file);
            const translatedFilePath = join(dir, `${name}-${targetLangSuffix}${ext}`);
            
            try {
                await readFile(translatedFilePath, 'utf8');
                console.log(`⏩ 跳过 ${file}: 已有翻译版本 ${translatedFilePath}`);
                skippedCount++;
                continue;
            } catch (err) {
                // 文件不存在，继续处理
            }

            // 翻译文章
            console.log(`🤖 正在翻译 ${file}...`);
            const translatedBody = await translateArticle(content.replaceAll('lang: zh', `lang: ${targetLangSuffix}`));

            if (!translatedBody) {
                console.log(`⚠️ 无法翻译 ${file}`);
                errorCount++;
                continue;
            }
            // 写入新文件
            await writeFile(translatedFilePath, translatedBody, 'utf8');

            console.log(`✅ 已翻译并保存到 ${translatedFilePath}`);
            translatedCount++;
        } catch (error) {
            console.error(`❌ 处理 ${file} 时出错: ${error.message}`);
            errorCount++;
        }
    }

    // 报告结果
    console.log('\n📊 处理结果:');
    console.log(`✅ 已翻译: ${translatedCount} 个文件`);
    console.log(`⏩ 已跳过: ${skippedCount} 个文件`);
    console.log(`❌ 出错: ${errorCount} 个文件`);
}

main().catch((error) => {
    console.error('❌ 执行失败:', error.message);
    process.exit(1);
});