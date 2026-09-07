# 本地同步 outbox 契约

`sync_operations` 是本地变更队列，不代表数据已经同步到远端。本版本不实现远端消费者；应用启动时只做有界清理，并可通过 `getPendingSyncOperationCount()` 读取当前工作区的未完成数量。

## 统一 payload

每条操作的 `payload` 都是以下结构：

```json
{
  "entity": "work_log",
  "public_id": "…",
  "version": 1,
  "changed_at": "2026-09-07T00:00:00.000Z",
  "action": "create",
  "data": {}
}
```

`operation_type` 只使用 `create`、`update`、`delete`。恢复操作使用 `operation_type: "update"` 并将 `action` 设为 `restore`；这样标签复活不会被误认为创建了一个新的标签。关联标签等附加动作保留在 `data.action` 中，实体级 `action` 仍遵守上述集合。

消费者必须使用 `public_id + version` 做幂等判断，只接受不早于本地已处理版本的变更，并以 `changed_at` 作为冲突处理的时间依据。`data` 是实体字段快照或变更字段集合，不能把随机的 outbox 行 id 当成实体 id。

## 保留与可观测性

当前没有远端消费者，因此 pending 记录不会被伪标记为已同步。已完成记录保留最近 5000 条，并按完成/失败时间清理历史记录；待处理记录不会被清理。`getPendingSyncOperationCount()` 用于诊断队列积压。

## 数据库传输边界

`sync_operations` 是设备本地队列，继续排除在 database export/import 之外。导出包不包含 outbox，导入也不会将源设备的 outbox 写入当前数据库；统一 serializer 不得改变这一边界。
