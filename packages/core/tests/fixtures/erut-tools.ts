import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const get_alarm_list = defineTool({
  name: 'get_alarm_list',
  description: "알람 목록을 조회한다. 장비 통신 문제와 센서 동작 문제 두 종류가 있다.",
  endpoint: 'POST /api/v0/alarm/list',
  params: z.object({
    status: z.enum(['UNCHECKED', 'CHECKED', 'RESOLVED']).describe('알람 처리 상태 (미확인/확인/조치완료)').optional(),
  }),
  requestBodyTemplate: {
  "pageNo": 1,
  "pageSize": 50
},
  responseMapping: {"dataPath":"contents.list","totalPath":"contents.totalCount"},
  responseType: 'table',
  columns: [{"key":"alarmId","label":"ID"},{"key":"alarmType","label":"유형","type":"badge"},{"key":"status","label":"상태"}],
  riskLevel: 'read',
  examples: ["미확인 알람 보여줘","알람 목록"],
})

export const get_alarm_counts = defineTool({
  name: 'get_alarm_counts',
  description: "알람 상태별 건수를 조회한다.",
  endpoint: 'POST /api/v0/alarm/counts',
  responseType: 'text',
  riskLevel: 'read',
  examples: ["알람 몇 건이야?"],
})

export const get_dashboard = defineTool({
  name: 'get_dashboard',
  description: "전체 현장의 종합 대시보드 데이터를 조회한다.",
  endpoint: 'POST /api/v0/dashboard/dashboard-data',
  responseType: 'text',
  riskLevel: 'read',
  examples: ["전체 현황 요약해줘","대시보드 보여줘"],
})

export const get_thickness_trend = defineTool({
  name: 'get_thickness_trend',
  description: "센서의 두께 변화 추이를 시계열로 조회한다.",
  endpoint: 'POST /api/v0/sensor/thickness-trend',
  params: z.object({
    sensorId: z.string().describe('센서 ID'),
  }),
  responseType: 'text',
  riskLevel: 'read',
  examples: ["MC-003 두께 트렌드 보여줘"],
})

export const update_alarm_status = defineTool({
  name: 'update_alarm_status',
  description: "알람의 처리 상태를 변경한다 (미확인→확인→조치완료).",
  endpoint: 'POST /api/v0/alarm/update',
  riskLevel: 'write',
  confirmMessage: "알람 상태를 변경합니다. 진행할까요?",
})

export const tools = [get_alarm_list, get_alarm_counts, get_dashboard, get_thickness_trend, update_alarm_status]