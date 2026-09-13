#!/bin/zsh
cd -- "${0:A:h}"
if curl -fsS --max-time 2 http://127.0.0.1:17882/api/health >/dev/null; then
  echo 'V2 已运行：http://127.0.0.1:17882/'
else
  echo '启动 V2，请保持此终端窗口打开：http://127.0.0.1:17882/'
  npm start
fi
