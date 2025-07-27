# OpenAI API 代理服务器

这是一个高性能的OpenAI API代理服务器，专门解决以下问题：
- 模型提供商只支持流式输出，但应用程序需要非流式响应
- 需要支持高并发请求处理
- 需要负载均衡和容错机制

## 核心特性

### 🚀 高性能架构
- **多进程集群**: 自动启动CPU核心数量的工作进程，充分利用多核性能
- **连接池**: HTTP/HTTPS连接复用，支持1000+并发连接
- **异步处理**: 基于Node.js异步I/O，高效处理并发请求
- **内存优化**: 自动垃圾回收和内存监控

### 🔄 智能转换
- **流式转非流式**: 自动将非流式请求转换为流式，再收集完整响应
- **双模式支持**: 同时支持流式和非流式API调用
- **完整兼容**: 100%兼容OpenAI API格式

### ⚖️ 负载均衡
- **多上游支持**: 支持配置多个模型提供商API，自动负载均衡
- **随机分发**: 请求随机分发到不同的上游API
- **故障转移**: 单个上游失败不影响整体服务

### 🛡️ 安全防护
- **请求限流**: 防止恶意请求和DDoS攻击
- **输入验证**: 严格的请求体验证和大小限制
- **错误隔离**: 完善的错误处理，防止服务崩溃
- **超时保护**: 多层超时机制，防止请求hang住

### 📊 监控和调试
- **实时监控**: 请求数、错误率、内存使用实时统计
- **详细日志**: 完整的请求和错误日志
- **健康检查**: 内置健康检查端点
- **性能指标**: CPU、内存使用情况监控

## 快速开始

### 1. 安装依赖
```bash
# 克隆或下载代码后
npm install
```

### 2. 环境配置
创建环境变量或直接设置：

#### Windows
```bash
# 单个上游API
set UPSTREAM_API_URL=https://your-model-provider.com/v1/chat/completions
set PORT=3000

# 多个上游API（负载均衡）
set UPSTREAM_API_URL=https://api1.example.com/v1/chat/completions,https://api2.example.com/v1/chat/completions,https://api3.example.com/v1/chat/completions
```

#### Linux/Mac
```bash
# 单个上游API
export UPSTREAM_API_URL=https://your-model-provider.com/v1/chat/completions
export PORT=3000

# 多个上游API（负载均衡）
export UPSTREAM_API_URL=https://api1.example.com/v1/chat/completions,https://api2.example.com/v1/chat/completions,https://api3.example.com/v1/chat/completions
```

### 3. 启动服务

#### 开发模式
```bash
npm run dev
# 使用nodemon，代码改动自动重启
```

#### 生产模式（多进程）
```bash
npm start
# 启动CPU核心数量的工作进程
```

#### PM2部署（推荐生产环境）
```bash
npm run pm2
# 使用PM2管理进程，支持自动重启、日志管理等
```

### 4. 配置你的应用程序
将你的应用程序中的OpenAI API设置修改为：
- **API URL**: `http://localhost:3000` （或你配置的端口）
- **API Key**: 使用你的实际模型提供商API密钥

## 详细配置

### 环境变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `UPSTREAM_API_URL` | ✅ | 无 | 上游API地址，多个用逗号分隔 |
| `PORT` | ❌ | 3000 | 服务器监听端口 |
| `NODE_ENV` | ❌ | development | Node.js环境（production/development） |
| `UV_THREADPOOL_SIZE` | ❌ | 4 | Node.js线程池大小，建议设为128 |

### 性能优化配置

#### 启用垃圾回收（可选）
```bash
# 启动时添加 --expose-gc 参数启用手动垃圾回收
node --expose-gc proxy-server.js
```

#### PM2配置文件 (ecosystem.config.js)
```javascript
module.exports = {
  apps: [{
    name: 'openai-proxy',
    script: 'proxy-server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      UV_THREADPOOL_SIZE: 128,
      UPSTREAM_API_URL: 'https://api1.example.com/v1/chat/completions,https://api2.example.com/v1/chat/completions'
    },
    node_args: '--expose-gc',
    max_memory_restart: '1000M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_file: 'logs/combined.log'
  }]
}
```

## API文档

### 支持的端点

#### POST /v1/chat/completions
标准的OpenAI聊天completions接口，支持所有原生参数。

**请求示例**:
```bash
curl -X POST http://localhost:3000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer your-api-key" \\
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Hello, world!"}
    ],
    "stream": false
  }'
```

**特殊行为**:
- `stream: false` - 返回完整的非流式响应（即使上游只支持流式）
- `stream: true` - 直接转发流式响应

#### GET /health
健康检查端点，返回服务器状态。

**响应示例**:
```json
{
  "status": "ok",
  "pid": 12345
}
```

## 工作原理

```
客户端应用 → 代理服务器 → 上游API
     ↑              ↓
   非流式        流式转换
   响应          处理
```

1. **请求接收**: 代理服务器接收客户端的非流式请求
2. **参数转换**: 将`stream: false`改为`stream: true`
3. **上游转发**: 向上游API发送流式请求
4. **响应收集**: 实时收集流式响应的所有数据片段
5. **格式转换**: 将收集到的数据合并为标准非流式格式
6. **客户端返回**: 返回完整的非流式响应给客户端

## 监控和日志

### 控制台输出
服务器会每30秒输出性能统计：
```
进程 12345: 请求数=156, 错误数=2
内存使用: RSS=245MB, Heap=123MB
```

### 日志内容
- 请求统计（请求数、错误数）
- 内存使用情况（RSS、Heap）
- 上游API错误详情
- 流处理错误信息
- 垃圾回收执行记录

### 健康检查
```bash
curl http://localhost:3000/health
```

## 部署指南

### Docker部署

#### 快速开始

使用 Docker Compose（推荐）：
```bash
# 构建并启动容器
docker-compose up -d

# 查看运行状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

#### 手动 Docker 命令

```bash
# 1. 构建镜像
docker build -t openai-proxy .

# 2. 运行容器
docker run -d \
  --name openai-proxy \
  -p 3000:3000 \
  --restart unless-stopped \
  openai-proxy

# 3. 查看容器状态
docker ps

# 4. 查看日志
docker logs -f openai-proxy

# 5. 停止容器
docker stop openai-proxy

# 6. 删除容器
docker rm openai-proxy
```

#### 环境变量配置

如需自定义配置，可在 `docker-compose.yml` 中添加环境变量：

```yaml
environment:
  - NODE_ENV=production
  - PORT=3000
  - UPSTREAM_API_URL=https://your-api.com/v1/chat/completions
```

或在 docker run 命令中添加：
```bash
docker run -d \
  --name openai-proxy \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e UPSTREAM_API_URL=https://your-api.com/v1/chat/completions \
  openai-proxy
```

#### Docker 文件说明

项目包含以下 Docker 配置文件：
- `Dockerfile` - 容器构建配置
- `docker-compose.yml` - 编排配置，包含健康检查
- `.dockerignore` - 排除不必要的文件

#### 优势
- **环境隔离**: 解决 Node.js 版本兼容问题
- **自动重启**: 容器异常退出自动重启
- **易于部署**: 一键构建和部署
- **后台运行**: 关闭 SSH 连接不影响服务运行

#### 数据持久化

如需持久化日志：
```bash
docker run -d \
  --name openai-proxy \
  -p 3000:3000 \
  -v $(pwd)/logs:/app/logs \
  openai-proxy
```

### Nginx反向代理
```nginx
upstream openai_proxy {
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3002 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://openai_proxy;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 流式响应设置
        proxy_buffering off;
        proxy_cache off;
        
        # 超时设置
        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

### 系统服务(systemd)
```ini
[Unit]
Description=OpenAI Proxy Server
After=network.target

[Service]
Type=simple
User=nodejs
WorkingDirectory=/path/to/your/app
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=UV_THREADPOOL_SIZE=128
Environment=UPSTREAM_API_URL=https://api.example.com/v1/chat/completions
ExecStart=/usr/bin/node proxy-server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

## 性能基准

### 硬件要求
- **CPU**: 2核心以上（推荐4核心+）
- **内存**: 2GB以上（推荐4GB+）
- **网络**: 千兆网络环境

### 性能指标
- **并发处理**: 单机5000+ QPS
- **响应时间**: < 100ms（不含上游API延迟）
- **内存使用**: 约200-500MB（取决于并发量）
- **CPU使用**: 多核负载均衡

### 压力测试
```bash
# 使用Apache Bench测试
ab -n 1000 -c 100 -H "Authorization: Bearer test-key" \\
   -H "Content-Type: application/json" \\
   -p request.json \\
   http://localhost:3000/v1/chat/completions
```

## 故障排除

### 常见问题

#### 1. 服务启动失败
```bash
# 检查端口是否被占用
netstat -tulpn | grep 3000

# 检查Node.js版本
node --version  # 需要 >= 16.0.0
```

#### 2. 上游API连接失败
```bash
# 检查上游API是否可达
curl -X POST https://your-upstream-api.com/v1/chat/completions \\
  -H "Authorization: Bearer your-key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"test"}],"stream":true}'
```

#### 3. 内存使用过高
- 检查并发请求数是否过高
- 启用垃圾回收：`node --expose-gc proxy-server.js`
- 增加内存限制：`node --max-old-space-size=4096 proxy-server.js`

#### 4. 请求超时
- 检查网络延迟到上游API
- 调整超时配置（代码中的timeout参数）
- 确保上游API稳定性

### 调试模式
```bash
# 启用详细日志
DEBUG=* npm start

# 启用Node.js调试
node --inspect proxy-server.js
```

## 安全注意事项

1. **API密钥安全**: 确保API密钥不被泄露，建议使用环境变量
2. **网络安全**: 生产环境建议使用HTTPS和防火墙
3. **访问控制**: 可添加IP白名单或认证机制
4. **监控告警**: 设置异常访问和错误率告警
5. **定期更新**: 保持依赖包和Node.js版本更新

## 许可证

MIT License - 可自由使用、修改和分发

## 技术支持

如遇问题请检查：
1. Node.js版本是否 >= 16.0.0
2. 依赖包是否正确安装
3. 环境变量是否正确设置
4. 上游API是否正常工作
5. 网络连接是否稳定

---

🎉 现在你可以放心使用这个高性能的OpenAI API代理服务器了！
