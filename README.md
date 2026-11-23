# EconoMind

面向学生、研究人员和商业分析用户的数字经济数据分析平台。

MVP 覆盖注册登录、CSV 导入、指标查询与增速计算、图表展示和基础导入管理。技术栈为 React、TypeScript、ECharts、FastAPI 和 PostgreSQL。

- `backend/` 存放服务端代码。
- `frontend/` 存放浏览器界面代码。
- `docs/` 存放架构、学习和更新记录。

本地 MVP 已支持注册登录、CSV 导入和季度指标分析。参见[路线图](ROADMAP.md)和[架构设计](docs/ARCHITECTURE.md)。

## 运行后端

在项目根目录运行以下 PowerShell 命令。已有 `.venv` 时可跳过第一行。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app
```

服务启动后，访问 `http://127.0.0.1:8000/docs` 查看接口文档，或在另一个 PowerShell 窗口执行 `Invoke-RestMethod http://127.0.0.1:8000/api/v1/indicators/gdp`。停止服务用 Ctrl+C。如果端口已被占用，可在启动命令末尾加 `--port 8001`，并更新访问地址。

运行测试用 `.\.venv\Scripts\python.exe -m pytest -q backend/tests`。若提示缺少模块，请用同一个虚拟环境的 Python 重新安装开发依赖。

## PostgreSQL 数据与季度指标

使用本地 PostgreSQL。用管理员在 `psql` 中创建项目专用账号和数据库，并用 `\password` 的提示交互设置密码。

```sql
CREATE ROLE economind LOGIN;
\password economind
CREATE DATABASE economind OWNER economind;
```

在项目根目录运行以下 PowerShell 命令。连接变量只在当前终端进程及其子进程中生效。

```powershell
$economindPassword = Read-Host 'PostgreSQL password' -MaskInput
$env:ECONOMIND_DATABASE_URL = 'postgresql+psycopg://economind:{0}@127.0.0.1:5432/economind' -f [uri]::EscapeDataString($economindPassword)
Remove-Variable economindPassword
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m backend.data_cli init
.\.venv\Scripts\python.exe -m backend.data_cli import data/sample-quarterly.csv --source 'Synthetic sample'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app
```

导入结果会输出 `dataset_id`。在另一个 PowerShell 窗口查询时，将示例 URL 中的 `1` 换成该值。

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/datasets/1/indicators/gdp/series?start=2025-Q1&end=2025-Q1' | ConvertTo-Json -Depth 5
```

样例为合成数据。GDP 的 2025 年第一季度值为 121，同比为 21%，环比为 10%。精确小数在 JSON 中以字符串表示，缺失或为零的基期对应 `null`。CSV 须为 UTF-8，首行为 `code,period,value`，文件上限为 2 MiB。重复的指标和季度会被拒绝，每次成功导入都会得到独立的数据集编号。若接口返回 503，请检查 PostgreSQL 是否启动、连接变量是否在启动后端的终端中设置，以及是否已执行建表命令。网页上传和账号权限的使用方法见后文。

## 运行前端仪表盘

先按上节启动 PostgreSQL 和后端，再打开另一个 PowerShell 窗口，从项目根目录运行。

```powershell
npm --prefix frontend ci
npm --prefix frontend run dev
```

打开终端显示的地址（默认 `http://127.0.0.1:5173`），注册并登录后，可从导入记录选择数据集，或输入数据集编号。选择 GDP 或 CPI，填写类似 `2025-Q1` 的季度并点击「查询指标」。页面显示原始观测值、同比、环比和数据来源。缺少中间季度时，趋势图保留空档。

Vite 将 `/api` 请求转发给本地 FastAPI。若后端改用其他端口，在启动 Vite 的终端设置 `$env:ECONOMIND_API_TARGET = 'http://127.0.0.1:8001'`。若页面提示数据集不存在，请使用当前数据库导入时输出的编号。

运行 `npm --prefix frontend run build` 可执行 TypeScript 检查并生成 `frontend/dist/`。部署时由同一站点提供构建产物并将 `/api` 转发到后端。

## 完成一次 MVP 操作

如果从第四阶段升级，请先更新后端依赖，并在设置了数据库连接变量的 PowerShell 中重新执行建表命令。命令会补齐账号和会话结构，保留已有数据。

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m backend.data_cli init
.\.venv\Scripts\python.exe -m uvicorn backend.main:app
```

打开前端后，先注册并登录。在「导入记录」填写来源，通过网页上传 `data/sample-quarterly.csv`。导入成功后页面会打开对应图表。以后可从导入记录点击「查看指标」。网页导入默认仅上传账号可见，命令行导入适用于可公开查询的共享数据。若复制了 PostgreSQL 命令行样例，建议用合成数据验证。

本地使用 HTTP，部署到 HTTPS 时为后端配置 `ECONOMIND_SECURE_COOKIES=1`。运行普通测试用 `.\.venv\Scripts\python.exe -m pytest -q backend/tests`。要运行 PostgreSQL 集成测试，请把 `ECONOMIND_TEST_DATABASE_URL` 指向允许创建和清理临时 schema 的测试数据库。
