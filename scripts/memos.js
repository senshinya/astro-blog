import https from 'https';
import { promises as fs } from 'fs';

const url = 'https://memos.shinya.click/api/memos?limit=10';

const requestOptions = {
    headers: {
        'Accept-Encoding': '',
    }
};

// 发出 GET 请求
https.get(url, requestOptions, (resp) => {
    let data = [];

    // 逐步接收数据
    resp.on('data', (chunk) => {
        data.push(chunk);
    });

    // 完成接收数据
    resp.on('end', async () => {
        try {
            // 将 Buffer 数组合并为一个 Buffer
            const buffer = Buffer.concat(data);
            const decodedData = buffer.toString('utf-8'); // 假设返回的数据是 UTF-8 编码

            // 保存 JSON 数据到文件
            await fs.writeFile('memos.json', decodedData);
            console.log('JSON 数据已保存到 memos.json');
        } catch (e) {
            console.error('解析 JSON 时出错:', e);
        }
    });

}).on('error', (err) => {
    console.error('获取数据时出错:', err);
});