# EconoMind

面向学生、研究人员和商业分析用户的数字经济数据分析平台。

MVP 覆盖注册登录、CSV 导入、指标查询与增速计算、图表展示和基础导入管理。技术栈为 React、TypeScript、ECharts、FastAPI 和 PostgreSQL。

- `backend/` 存放服务端代码。
- `frontend/` 存放浏览器界面代码。
- `docs/` 存放架构、学习和更新记录。

项目目前处于准备阶段，应用将在后续阶段逐步实现。参见[路线图](ROADMAP.md)和[架构设计](docs/ARCHITECTURE.md)。

## 运行后端

在项目根目录运行以下 PowerShell 命令。已有 `.venv` 时可跳过第一行。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app
```

服务启动后，访问 `http://127.0.0.1:8000/docs` 查看接口文档，或在另一个 PowerShell 窗口执行 `Invoke-RestMethod http://127.0.0.1:8000/api/v1/indicators/gdp`。停止服务用 Ctrl+C。如果端口已被占用，可在启动命令末尾加 `--port 8001`，并更新访问地址。

运行测试用 `.\.venv\Scripts\python.exe -m pytest -q backend/tests`。若提示缺少模块，请用同一个虚拟环境的 Python 重新安装开发依赖。
