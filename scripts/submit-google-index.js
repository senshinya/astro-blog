import { google } from 'googleapis';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

class GoogleIndexingAPI {
  constructor(serviceAccountKeyPath) {
    this.auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountKeyPath,
      scopes: ['https://www.googleapis.com/auth/indexing']
    });
    
    this.indexing = google.indexing('v3');
  }

  /**
   * 从 sitemap 获取 URL 列表
   * @param {string} sitemapUrl - sitemap URL
   * @param {boolean} includeImages - 是否包含图片 URL
   */
  async getUrlsFromSitemap(sitemapUrl, includeImages = false) {
    try {
      console.log(`正在获取 sitemap: ${sitemapUrl}`);
      
      const response = await fetch(sitemapUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const xmlContent = await response.text();
      const parsedXml = await parseStringPromise(xmlContent);
      
      let urls = [];
      
      // 检查是否是 sitemap index
      if (parsedXml.sitemapindex) {
        console.log('检测到 sitemap index，正在处理子 sitemap...');
        const sitemaps = parsedXml.sitemapindex.sitemap || [];
        
        for (const sitemap of sitemaps) {
          const subSitemapUrl = sitemap.loc[0];
          console.log(`处理子 sitemap: ${subSitemapUrl}`);
          const subUrls = await this.getUrlsFromSitemap(subSitemapUrl, includeImages);
          urls.push(...subUrls);
        }
      }
      // 处理普通 sitemap
      else if (parsedXml.urlset) {
        const urlEntries = parsedXml.urlset.url || [];
        
        for (const urlEntry of urlEntries) {
          const url = urlEntry.loc[0];
          const lastmod = urlEntry.lastmod ? urlEntry.lastmod[0] : null;
          const priority = urlEntry.priority ? parseFloat(urlEntry.priority[0]) : null;
          const changefreq = urlEntry.changefreq ? urlEntry.changefreq[0] : null;
          
          urls.push({
            url,
            lastmod,
            priority,
            changefreq
          });
          
          // 如果需要包含图片 URL
          if (includeImages && urlEntry['image:image']) {
            const images = Array.isArray(urlEntry['image:image']) 
              ? urlEntry['image:image'] 
              : [urlEntry['image:image']];
              
            for (const image of images) {
              if (image['image:loc']) {
                urls.push({
                  url: image['image:loc'][0],
                  type: 'image',
                  parentUrl: url
                });
              }
            }
          }
        }
      }
      
      console.log(`从 sitemap 获取到 ${urls.length} 个 URL`);
      return urls;
      
    } catch (error) {
      console.error(`获取 sitemap 失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 过滤 URL
   * @param {Array} urls - URL 列表
   * @param {Object} filters - 过滤条件
   */
  filterUrls(urls, filters = {}) {
    let filteredUrls = [...urls];
    
    // 按优先级过滤
    if (filters.minPriority) {
      filteredUrls = filteredUrls.filter(item => 
        !item.priority || item.priority >= filters.minPriority
      );
    }
    
    // 按修改时间过滤
    if (filters.afterDate) {
      const afterDate = new Date(filters.afterDate);
      filteredUrls = filteredUrls.filter(item => 
        !item.lastmod || new Date(item.lastmod) >= afterDate
      );
    }
    
    // 按 URL 模式过滤
    if (filters.includePatterns) {
      const patterns = Array.isArray(filters.includePatterns) 
        ? filters.includePatterns 
        : [filters.includePatterns];
      
      filteredUrls = filteredUrls.filter(item =>
        patterns.some(pattern => new RegExp(pattern).test(item.url))
      );
    }
    
    // 排除某些 URL 模式
    if (filters.excludePatterns) {
      const patterns = Array.isArray(filters.excludePatterns) 
        ? filters.excludePatterns 
        : [filters.excludePatterns];
      
      filteredUrls = filteredUrls.filter(item =>
        !patterns.some(pattern => new RegExp(pattern).test(item.url))
      );
    }
    
    // 只保留图片或排除图片
    if (filters.imagesOnly) {
      filteredUrls = filteredUrls.filter(item => item.type === 'image');
    } else if (filters.excludeImages) {
      filteredUrls = filteredUrls.filter(item => item.type !== 'image');
    }
    
    console.log(`过滤后剩余 ${filteredUrls.length} 个 URL`);
    return filteredUrls;
  }

  /**
   * 提交单个 URL
   * @param {string} url - 要提交的 URL
   * @param {string} type - 操作类型
   */
  async submitUrl(url, type = 'URL_UPDATED') {
    try {
      const authClient = await this.auth.getClient();
      
      const response = await this.indexing.urlNotifications.publish({
        auth: authClient,
        requestBody: { url, type }
      });
      
      return { success: true, url, response: response.data };
    } catch (error) {
      return { success: false, url, error: error.message };
    }
  }

  /**
   * 批量提交 URL
   * @param {Array} urlItems - URL 项目数组
   * @param {string} type - 操作类型
   * @param {number} delay - 请求间隔
   */
  async batchSubmitUrls(urlItems, type = 'URL_UPDATED', delay = 1000) {
    const results = [];
    
    console.log(`开始批量提交 ${urlItems.length} 个 URL...`);
    
    for (let i = 0; i < urlItems.length; i++) {
      const urlItem = urlItems[i];
      const url = typeof urlItem === 'string' ? urlItem : urlItem.url;
      
      console.log(`提交第 ${i + 1}/${urlItems.length} 个 URL: ${url}`);
      
      const result = await this.submitUrl(url, type);
      results.push({
        ...result,
        originalItem: urlItem
      });
      
      if (result.success) {
        console.log(`✅ 成功: ${url}`);
      } else {
        console.log(`❌ 失败: ${url} - ${result.error}`);
      }
      
      if (i < urlItems.length - 1) {
        await this.sleep(delay);
      }
    }
    
    return results;
  }

  /**
   * 从 sitemap 提交到 Google 索引（主要方法）
   * @param {string} sitemapUrl - sitemap URL
   * @param {Object} options - 选项
   */
  async submitFromSitemap(sitemapUrl, options = {}) {
    const {
      filters = {},
      type = 'URL_UPDATED',
      delay = 1000,
      includeImages = false,
      maxUrls = null
    } = options;
    
    try {
      // 获取 URL
      const urls = await this.getUrlsFromSitemap(sitemapUrl, includeImages);
      
      // 过滤 URL
      let filteredUrls = this.filterUrls(urls, filters);
      
      // 限制数量
      if (maxUrls && filteredUrls.length > maxUrls) {
        console.log(`限制提交数量为 ${maxUrls} 个 URL`);
        filteredUrls = filteredUrls.slice(0, maxUrls);
      }
      
      if (filteredUrls.length === 0) {
        console.log('没有找到符合条件的 URL');
        return { urls: [], results: [] };
      }
      
      // 批量提交
      const results = await this.batchSubmitUrls(filteredUrls, type, delay);
      
      // 生成报告
      const report = this.generateReport(results);
      
      return { urls: filteredUrls, results, report };
      
    } catch (error) {
      console.error('从 sitemap 提交过程中发生错误:', error);
      throw error;
    }
  }

  /**
   * 生成提交报告
   * @param {Array} results - 提交结果数组
   */
  generateReport(results) {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    const report = {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      successRate: ((successful.length / results.length) * 100).toFixed(2) + '%',
      failedUrls: failed.map(f => ({ url: f.url, error: f.error }))
    };
    
    console.log('\n📊 提交报告:');
    console.log(`总计: ${report.total}`);
    console.log(`成功: ${report.successful}`);
    console.log(`失败: ${report.failed}`);
    console.log(`成功率: ${report.successRate}`);
    
    if (failed.length > 0) {
      console.log('\n失败的 URL:');
      failed.forEach(f => {
        console.log(`- ${f.url}: ${f.error}`);
      });
    }
    
    return report;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 使用示例
async function submitSitemapToGoogle() {
  const indexingAPI = new GoogleIndexingAPI('./service-account-key.json');
  
  const sitemapUrl = 'https://shinya.click/sitemap-0.xml';

  const options = {
    filters: {
      // 排除某些路径
      excludePatterns: ['.*/tags/.*'],
      
      // 排除图片
      excludeImages: true
    },
    
    // 包含图片 URL
    includeImages: false
  };
  
  try {
    const { urls, results, report } = await indexingAPI.submitFromSitemap(sitemapUrl, options);
    
    console.log('\n✅ 提交完成!');
    console.log(`处理了 ${urls.length} 个 URL`);
    
    return { urls, results, report };
    
  } catch (error) {
    console.error('❌ 提交失败:', error);
    throw error;
  }
}

// 执行提交
submitSitemapToGoogle()
  .then(({ report }) => {
    console.log('\n🎉 所有操作完成!');
  })
  .catch(error => {
    console.error('💥 操作失败:', error);
  });

export default GoogleIndexingAPI;