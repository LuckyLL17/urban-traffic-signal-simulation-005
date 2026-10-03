# 城市交通信号配时与拥堵传播仿真服务

纯后端 Node.js + TypeScript + Fastify 服务，默认无需 Docker、数据库或消息中间件即可运行。

## 启动

```bash
npm install
npm run dev
```

默认端口：`6302`。健康检查：`GET /health`。

## 业务闭环

- 领域状态模型与事件输入
- 可回放的时间序列/仿真流程
- 约束校验与风险门禁
- 方案版本、审计轨迹与异常处置
- 所有状态暂存于进程内，便于本机演示；可扩展为数据库、事件总线和实时流处理架构

## 增强业务闭环

- 路口走廊协调与基于车速的绿波 offset 计算
- 公交、应急车辆优先请求及乘客量/请求类型决策
- 行人过街、无障碍和最小安全过街时间校验
- 仿真后的 CO2、NOx、怠速小时估算
- 疏散场景、封闭路口和上游拥堵外溢推演

扩展接口：`/api/corridors`、`/api/priority-requests`、`/api/pedestrian-phase`、`/api/evacuation-scenarios`、`/api/simulations/:id/emissions`。

## 优先请求 × 行人安全决策流程

`POST /api/priority-requests` 与 `/api/pedestrian-phase` 通过统一决策引擎 `decidePriorityRequest` 关联。提交公交（`transit`）或应急（`emergency`）请求时，按以下顺序评估并返回 `approved` / `deferred` / `rejected` 及可解释的 `reasonCode` + 中文 `reason`：

1. **ETA 校验**：`etaSeconds < 0` 或非数字 → `rejected / eta-expired`（过期 ETA，不再可能安排优先）。
2. **重复提交**：同 `intersectionId + routeId + requestType` 在 120s 窗口内已有非拒绝请求 → `rejected / duplicate-request`，响应中的 `duplicateOf` 指向首单；已拒绝（如过期）的请求不占窗口，修正后可重提。
3. **行人过街约束**：读取该路口最新 `validated` 行人相位，所需安全清空时间 `requiredClearance = crossingSeconds + leadingInterval`：
   - `ETA < requiredClearance`：应急 → `rejected / pedestrian-safety-conflict`（禁止在行人无法安全清空时抢占）；公交 → `deferred / pedestrian-clearance-pending`。响应 `pedestrian` 字段给出 `shortfallSeconds` 等证据。
   - `ETA >= requiredClearance`：约束满足（`constraint: satisfied`），进入既有规则。
   - 路口无行人策略：`constraint: none`，不施加过街约束。
4. **既有类型/乘客量规则**（在安全约束通过后）：应急 → `approved / emergency-priority`；公交 `passengers >= 20` → `approved / high-occupancy`；普通低客流公交 → `deferred / low-occupancy`（保留原有延后行为）。

辅助接口：

- `POST /api/pedestrian-phase`：登记行人相位（7–60s），返回含 `requiredClearance` 的已验证策略。
- `GET /api/pedestrian-phase?intersectionId=`：查询行人策略。
- `GET /api/priority-requests`：支持 `intersectionId`、`routeId`、`requestType`、`status` 过滤，返回 `{priorityRequests, count}`。
- `GET /api/priority-requests/:id`：查询单条决策结果。
