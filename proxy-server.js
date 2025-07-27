const express = require('express');
const fetch = require('node-fetch');
const cluster = require('cluster');
const os = require('os');
const http = require('http');
const https = require('https');

// 配置连接池
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 50,
  timeout: 30000,
  freeSocketTimeout: 15000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 50,
  timeout: 30000,
  freeSocketTimeout: 15000
});

// 集群模式启动
if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`启动 ${numCPUs} 个工作进程`);
  
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`工作进程 ${worker.process.pid} 已退出 (code: ${code}, signal: ${signal})，重启中...`);
    cluster.fork();
  });
  
  // 优雅关闭处理
  process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，正在关闭集群...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.log('收到SIGINT信号，正在关闭集群...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });
  
  return;
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// 启用gzip压缩
const compression = require('compression');
app.use(compression());

// 请求限流
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 1000, // 每分钟最多1000个请求
  message: { error: 'Too many requests' }
});
app.use('/v1/', limiter);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', pid: process.pid });
});

// 性能监控
let requestCount = 0;
let errorCount = 0;
const monitorInterval = setInterval(() => {
  try {
    const memUsage = process.memoryUsage();
    console.log(`进程 ${process.pid}: 请求数=${requestCount}, 错误数=${errorCount}`);
    console.log(`内存使用: RSS=${Math.round(memUsage.rss/1024/1024)}MB, Heap=${Math.round(memUsage.heapUsed/1024/1024)}MB`);
    
    // 内存使用过高时触发垃圾回收
    if (memUsage.heapUsed > 500 * 1024 * 1024 && global.gc) {
      try {
        global.gc();
        console.log('执行垃圾回收');
      } catch (gcError) {
        console.warn('垃圾回收失败:', gcError.message);
      }
    }
  } catch (monitorError) {
    console.error('性能监控错误:', monitorError.message);
  }
  
  requestCount = 0;
  errorCount = 0;
}, 30000);

// 输入验证中间件
app.use('/v1/chat/completions', (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  if (!req.body.messages || !Array.isArray(req.body.messages)) {
    return res.status(400).json({ error: 'Messages field is required and must be an array' });
  }
  
  if (req.body.messages.length === 0) {
    return res.status(400).json({ error: 'Messages array cannot be empty' });
  }
  
  if (req.body.messages.length > 100) {
    return res.status(400).json({ error: 'Too many messages' });
  }
  
  if (!req.headers.authorization) {
    return res.status(401).json({ error: 'Authorization header is required' });
  }
  
  // 简单检查消息内容长度，避免JSON.stringify开销
  let totalLength = 0;
  for (const msg of req.body.messages) {
    if (msg.content && typeof msg.content === 'string') {
      totalLength += msg.content.length;
      if (totalLength > 1000000) { // 1MB限制
        return res.status(413).json({ error: 'Request content too large' });
      }
    }
  }
  
  next();
});

app.post('/v1/chat/completions', async (req, res) => {
  const startTime = Date.now();
  requestCount++;
  
  // 设置请求超时
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      errorCount++;
      res.status(408).json({ error: 'Request timeout' });
    }
  }, 180000); // 3分钟超时
  
  try {
    const { stream, ...otherParams } = req.body;
    
    // 强制设置为流式请求
    const streamRequest = {
      ...otherParams,
      stream: true
    };

    // 获取代理URL（支持多个上游API负载均衡）
    const upstreamUrls = (process.env.UPSTREAM_API_URL || '').split(',')
      .map(url => url.trim())
      .filter(url => url && (url.startsWith('http://') || url.startsWith('https://')));
    
    if (upstreamUrls.length === 0) {
      clearTimeout(timeout);
      errorCount++;
      return res.status(500).json({ error: 'No valid upstream API configured' });
    }
    
    const upstreamUrl = upstreamUrls[Math.floor(Math.random() * upstreamUrls.length)];

    // 转发到实际的模型提供商API（使用连接池）
    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization,
        'User-Agent': 'OpenAI-Proxy/1.0'
      },
      body: JSON.stringify(streamRequest),
      agent: upstreamUrl.startsWith('https:') ? httpsAgent : httpAgent,
      timeout: 120000 // 2分钟超时
    });

    if (!response.ok) {
      clearTimeout(timeout);
      errorCount++;
      try {
        const errorText = await Promise.race([
          response.text(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Read timeout')), 5000))
        ]);
        console.error(`上游API错误 (${response.status}):`, errorText.substring(0, 200));
      } catch (textError) {
        console.error(`上游API错误 (${response.status}): 无法读取错误详情`);
      }
      return res.status(response.status).json({ 
        error: 'Upstream API error',
        status: response.status
      });
    }

    // 如果原请求是非流式，收集所有流式响应并合并
    if (!stream) {
      let fullContent = '';
      let usage = null;
      let model = null;
      let id = null;
      let created = null;
      let buffer = '';
      
      try {
        // 使用异步迭代器处理流，更高效，但添加超时保护
        const streamPromise = (async () => {
          for await (const chunk of response.body) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的行
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') return; // 正常结束
                
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.choices?.[0]?.delta?.content) {
                    fullContent += parsed.choices[0].delta.content;
                  }
                  if (parsed.usage) usage = parsed.usage;
                  if (parsed.model) model = parsed.model;
                  if (parsed.id) id = parsed.id;
                  if (parsed.created) created = parsed.created;
                } catch (e) {
                  // 忽略JSON解析错误
                }
              }
            }
          }
        })();
        
        // 添加超时保护，防止流处理hang住
        await Promise.race([
          streamPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Stream processing timeout')), 120000)
          )
        ]);
      } catch (streamError) {
        clearTimeout(timeout);
        errorCount++;
        console.error('流处理错误:', streamError.message);
        return res.status(500).json({ 
          error: 'Stream processing error',
          message: streamError.message
        });
      }
      
      // 返回标准的非流式响应格式
      clearTimeout(timeout);
      res.json({
        id: id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: created || Math.floor(Date.now() / 1000),
        model: model || 'gpt-3.5-turbo',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: fullContent
          },
          finish_reason: 'stop'
        }],
        usage: usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    } else {
      // 流式请求直接转发
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
      
      // 处理客户端断开连接
      req.on('close', () => {
        clearTimeout(timeout);
        if (response.body && !response.body.destroyed) {
          response.body.destroy();
        }
      });
      
      // 处理管道错误
      response.body.on('error', (pipeError) => {
        clearTimeout(timeout);
        console.error('上游流错误:', pipeError.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });
      
      response.body.pipe(res);
      
      // 清理超时当响应完成
      res.on('finish', () => clearTimeout(timeout));
    }
  } catch (error) {
    clearTimeout(timeout);
    errorCount++;
    const duration = Date.now() - startTime;
    console.error(`代理错误 (${duration}ms):`, error.message);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`代理服务器进程 ${process.pid} 运行在端口 ${PORT}`);
  console.log(`应用程序API URL设置为: http://localhost:${PORT}`);
});

// 优雅关闭处理
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在关闭服务器...');
  clearInterval(monitorInterval);
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到SIGINT信号，正在关闭服务器...');
  clearInterval(monitorInterval);
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});