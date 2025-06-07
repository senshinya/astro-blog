/**
 * 自动生成文章描述脚本
 *
 * 扫描src/content目录下的所有Markdown文件，检查它们的front matter，
 * 如果没有description或description为空，则调用OpenAI API生成description并更新文件。
 *
 * 使用方法: node scripts/generate-descriptions.js
 * 环境变量:
 *   - OPENAI_API_KEY: OpenAI API密钥（必需）
 *   - OPENAI_API_BASE_URL: OpenAI API基础URL（可选，默认为官方API）
 * 
 * 依赖: npm install openai dotenv
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

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

// 将解析后的frontmatter转换回字符串
function stringifyFrontmatter(data) {
    let result = '';

    for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
            result += `${key}:\n`;
            for (const item of value) {
                result += `  - ${item}\n`;
            }
        } else {
            result += `${key}: ${value}\n`;
        }
    }

    return result;
}

// 使用OpenAI生成描述
async function generateDescription(title, content) {
    try {
        // 提取内容的前500个字符作为上下文
        const context = content.substring(0, 3000);

        // 使用Chat Completions API而不是Responses API
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // 或者使用其他可用模型
            messages: [
                {
                    role: "system",
                    content: "你是一个专业的内容描述生成助手，可以为文章生成简短精确的描述。"
                },
                {
                    role: "user",
                    content: `以自然、随性、不做作的方式，根据下方标题和内容开头写一段50到100字的描述。不要使用介绍、总结、打招呼或互动语气，避免套路化和刻意吸引。直接展开内容，风格流畅简洁，只输出正文描述，不加引号或多余说明。\n\n标题：${title}\n\n内容开头：${context}`
                }
            ],
            temperature: 0.7,
            max_tokens: 1000
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error(`生成描述时出错: ${error.message}`);
        return '';
    }
}

async function main() {
    console.log('🔍 扫描Markdown文件...');

    // 查找所有Markdown文件
    const files = await fg(['src/content/**/*.md']);
    console.log(`📦 找到 ${files.length} 个Markdown文件`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const file of files) {
        try {
            // 读取文件内容
            const content = await readFile(file, 'utf8');
            const { frontmatter, body, hasFrontmatter } = splitContent(content);

            // 如果没有frontmatter，跳过
            if (!hasFrontmatter) {
                console.log(`⏩ 跳过 ${file}: 没有frontmatter`);
                skippedCount++;
                continue;
            }

            // 解析frontmatter
            const data = parseFrontmatter(frontmatter);

            // 检查description是否存在且不为空
            if (data.description && data.description.trim() !== '' && data.description !== "''") {
                console.log(`⏩ 跳过 ${file}: 已有description`);
                skippedCount++;
                continue;
            }

            // 生成description
            console.log(`🤖 为 ${file} 生成description...`);
            const description = await generateDescription(data.title || '', body);

            if (!description) {
                console.log(`⚠️ 无法为 ${file} 生成description`);
                errorCount++;
                continue;
            }
            console.log(`📝 生成的description: ${description}`);
            // 更新frontmatter
            data.description = `"${description}"`;
            const newFrontmatter = stringifyFrontmatter(data);

            // 更新文件内容
            const newContent = `---\n${newFrontmatter}---\n${body}`;
            await writeFile(file, newContent, 'utf8');

            console.log(`✅ 已更新 ${file}`);
            updatedCount++;
        } catch (error) {
            console.error(`❌ 处理 ${file} 时出错: ${error.message}`);
            errorCount++;
        }
    }

    // 报告结果
    console.log('\n📊 处理结果:');
    console.log(`✅ 已更新: ${updatedCount} 个文件`);
    console.log(`⏩ 已跳过: ${skippedCount} 个文件`);
    console.log(`❌ 出错: ${errorCount} 个文件`);
}

main().catch((error) => {
    console.error('❌ 执行失败:', error.message);
    process.exit(1);
});