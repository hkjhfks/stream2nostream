# 使用官方Node.js 18运行时作为基础镜像
FROM node:18-alpine

# 安装健康检查工具
RUN apk add --no-cache wget

# 创建非root用户（先创建用户再设置工作目录）
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# 设置工作目录
WORKDIR /app

# 更改工作目录所有权
RUN chown -R nodejs:nodejs /app

# 切换到非root用户
USER nodejs

# 复制package.json（没有package-lock.json）
COPY --chown=nodejs:nodejs package.json ./

# 安装依赖
RUN npm install --only=production && npm cache clean --force

# 复制应用代码
COPY --chown=nodejs:nodejs . .

# 暴露端口（根据你的应用端口调整）
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]