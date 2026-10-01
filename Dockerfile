FROM nginx:alpine

# 复制项目文件
COPY . /usr/share/nginx/html

# 创建AK注入脚本
RUN echo '#!/bin/sh\n\
if [ -n "$BMAP_AK" ]; then\n\
  sed -i "s/__BMAP_AK__/$BMAP_AK/g" /usr/share/nginx/html/index.html\n\
  echo "BMAP_AK injected."\n\
else\n\
  echo "Warning: BMAP_AK not set, map will not load."\n\
fi\n\
nginx -g "daemon off;"' > /docker-entrypoint.d/40-inject-ak.sh \
  && chmod +x /docker-entrypoint.d/40-inject-ak.sh

EXPOSE 80
