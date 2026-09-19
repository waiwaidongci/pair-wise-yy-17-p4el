module.exports = {
  port: 3912,
  title: '钟乳石洞穴微环境巡测',
  lede: '仪器校准与巡测准入闭环：巡测绑定当次设备与有效校准，校准过期、设备停用或量程不符只留档待复测、不计入异常统计；设备未归还不能再分配，换班连同校准状态交接；校准更正后未复核巡测失效，重测合格方可恢复。',
  tones: {
    '常规观察': 'ok',
    '正常': 'ok',
    '已复查': 'ok',
    '有效': 'ok',
    '合格': 'ok',
    '在用': 'ok',
    '重点保护': 'warn',
    '待复测': 'warn',
    '异常待复查': 'bad',
    '暂停开放': 'bad',
    '不合格': 'bad',
    '停用': 'bad'
  },
  collections: {
    sites: { label: '样点档案' },
    devices: { label: '设备台账' },
    calibrations: { label: '校准记录' },
    surveys: { label: '巡测记录' }
  },
  stats: [
    { label: '样点', collection: 'sites' },
    { label: '重点保护', collection: 'sites', filters: [{ field: 'protectedStatus', value: '重点保护' }] },
    { label: '有效巡测', collection: 'surveys', filters: [{ field: 'admission', value: '有效' }] },
    { label: '异常待复查', collection: 'surveys', filters: [{ field: 'status', value: '异常待复查' }, { field: 'admission', value: '有效' }] },
    { label: '待复测留档', collection: 'surveys', filters: [{ field: 'admission', value: '待复测' }] },
    { label: '设备领用中', collection: 'devices', filters: [{ field: 'assignedTo', op: 'ne', value: '' }] },
    { label: '校准过期', collection: 'calibrations', filters: [{ field: 'validUntil', op: 'lt', value: '$today' }] }
  ],
  views: [
    {
      id: 'dashboard',
      label: '闭环看板',
      type: 'dashboard',
      focus: [
        {
          title: '异常待复查（仅统计有效巡测）',
          collection: 'surveys',
          filters: [{ field: 'status', values: ['异常待复查'] }, { field: 'admission', values: ['有效'] }],
          limit: 8
        },
        {
          title: '待复测留档（不计入异常统计）',
          collection: 'surveys',
          filters: [{ field: 'admission', values: ['待复测'] }],
          limit: 8
        },
        {
          title: '设备领用中（未归还）',
          collection: 'devices',
          filters: [{ field: 'assignedTo', op: 'ne', value: '' }],
          limit: 8
        }
      ]
    },
    {
      id: 'surveys',
      label: '巡测登记',
      collection: 'surveys',
      formTitle: '登记巡测',
      listTitle: '巡测历史',
      submitLabel: '保存巡测',
      idempotency: true,
      searchPlaceholder: '搜索人员、干扰痕迹、照片',
      searchFields: ['surveyor', 'disturbance', 'photoUrl'],
      statusField: 'status',
      statusOptions: ['正常', '异常待复查', '已复查'],
      pills: ['status', 'admission'],
      titleFields: ['surveyor', 'date'],
      relation: { collection: 'sites', localKey: 'siteId', labelFields: ['cave', 'zone', 'pointCode'] },
      summaryFields: ['admissionReason', 'disturbance', 'reviewNote'],
      detailFields: [
        { label: '当次设备', name: 'deviceId', type: 'relation', collection: 'devices', labelFields: ['code', 'model'] },
        { label: '校准记录', name: 'calibrationId', type: 'relation', collection: 'calibrations', labelFields: ['result', 'validUntil'] },
        { label: '温度', name: 'temperature' },
        { label: '湿度', name: 'humidity' },
        { label: 'CO2', name: 'co2' },
        { label: '滴水频率', name: 'dripRate' }
      ],
      defaults: { status: '正常', reviewNote: '' },
      fields: [
        { label: '样点', name: 'siteId', type: 'relation', collection: 'sites', labelFields: ['cave', 'zone', 'pointCode'], required: true, wide: true },
        { label: '当次设备', name: 'deviceId', type: 'relation', collection: 'devices', labelFields: ['code', 'model'], required: true },
        { label: '校准记录', name: 'calibrationId', type: 'relation', collection: 'calibrations', labelFields: ['result', 'validUntil', 'calibratedAt'], required: true, dependsOn: { source: 'deviceId', match: 'deviceId' } },
        { label: '巡测人员', name: 'surveyor', required: true },
        { label: '日期', name: 'date', type: 'date', required: true },
        { label: '温度', name: 'temperature', type: 'number', required: true },
        { label: '湿度', name: 'humidity', type: 'number', required: true },
        { label: 'CO2', name: 'co2', type: 'number', required: true },
        { label: '滴水频率', name: 'dripRate', type: 'number', required: true },
        { label: '照片链接', name: 'photoUrl' },
        { label: '游客干扰痕迹', name: 'disturbance', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'devices',
      label: '设备台账',
      collection: 'devices',
      formTitle: '新增设备',
      listTitle: '设备列表',
      submitLabel: '保存设备',
      searchPlaceholder: '搜索编号、型号、领用人',
      searchFields: ['code', 'model', 'assignedTo'],
      statusField: 'status',
      statusOptions: ['在用', '停用'],
      titleFields: ['code', 'model'],
      summaryFields: ['note'],
      detailFields: [
        { label: '量程下限℃', name: 'rangeMin' },
        { label: '量程上限℃', name: 'rangeMax' },
        { label: '当前领用', name: 'assignedTo' }
      ],
      defaults: { status: '在用', assignedTo: '' },
      fields: [
        { label: '设备编号', name: 'code', required: true },
        { label: '型号', name: 'model', required: true },
        { label: '量程下限(℃)', name: 'rangeMin', type: 'number', required: true },
        { label: '量程上限(℃)', name: 'rangeMax', type: 'number', required: true },
        { label: '状态', name: 'status', type: 'select', options: ['在用', '停用'] },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'calibrations',
      label: '校准记录',
      collection: 'calibrations',
      formTitle: '登记校准',
      listTitle: '校准历史',
      submitLabel: '保存校准',
      searchPlaceholder: '搜索机构、结果、备注',
      searchFields: ['agency', 'result', 'note'],
      statusField: 'result',
      statusOptions: ['合格', '不合格'],
      titleFields: ['result', 'validUntil'],
      relation: { collection: 'devices', localKey: 'deviceId', labelFields: ['code', 'model'] },
      summaryFields: ['correctionNote', 'note'],
      detailFields: [
        { label: '校准日期', name: 'calibratedAt' },
        { label: '有效期至', name: 'validUntil' },
        { label: '校准机构', name: 'agency' }
      ],
      defaults: { result: '合格' },
      fields: [
        { label: '设备', name: 'deviceId', type: 'relation', collection: 'devices', labelFields: ['code', 'model'], required: true, wide: true },
        { label: '校准日期', name: 'calibratedAt', type: 'date', required: true },
        { label: '有效期至', name: 'validUntil', type: 'date', required: true },
        { label: '校准结果', name: 'result', type: 'select', options: ['合格', '不合格'] },
        { label: '校准机构', name: 'agency' },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'sites',
      label: '样点档案',
      collection: 'sites',
      formTitle: '新增样点',
      listTitle: '样点列表',
      submitLabel: '保存样点',
      searchPlaceholder: '搜索洞穴、分区、样点、路线',
      searchFields: ['cave', 'zone', 'pointCode', 'route'],
      statusField: 'protectedStatus',
      statusOptions: ['常规观察', '重点保护', '暂停开放'],
      titleFields: ['pointCode', 'zone'],
      summaryFields: ['note'],
      detailFields: [
        { label: '洞穴', name: 'cave' },
        { label: '巡测路线', name: 'route' },
        { label: '敏感等级', name: 'sensitivity' }
      ],
      fields: [
        { label: '洞穴', name: 'cave', required: true },
        { label: '分区', name: 'zone', required: true },
        { label: '样点编号', name: 'pointCode', required: true },
        { label: '巡测路线', name: 'route', required: true },
        { label: '敏感等级', name: 'sensitivity', type: 'select', options: ['低', '中', '高'] },
        { label: '保护状态', name: 'protectedStatus', type: 'select', options: ['常规观察', '重点保护', '暂停开放'] },
        { label: '基准温度', name: 'baselineTemp', type: 'number', required: true },
        { label: '基准湿度', name: 'baselineHumidity', type: 'number', required: true },
        { label: '基准CO2', name: 'baselineCo2', type: 'number', required: true },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    }
  ],
  actions: [
    { id: 'site-normal', label: '常规观察', collection: 'sites', patches: [{ field: 'protectedStatus', value: '常规观察' }] },
    { id: 'site-focus', label: '重点保护', collection: 'sites', patches: [{ field: 'protectedStatus', value: '重点保护' }] },
    { id: 'site-close', label: '暂停开放', collection: 'sites', danger: true, patches: [{ field: 'protectedStatus', value: '暂停开放' }] },
    {
      id: 'device-assign',
      label: '分配',
      collection: 'devices',
      handler: 'assignDevice',
      showWhen: [{ field: 'assignedTo', value: '' }, { field: 'status', value: '在用' }],
      prompts: [{ name: 'operator', label: '领用人', required: true }]
    },
    {
      id: 'device-return',
      label: '归还',
      collection: 'devices',
      handler: 'returnDevice',
      showWhen: { field: 'assignedTo', op: 'ne', value: '' }
    },
    {
      id: 'device-handover',
      label: '换班交接',
      collection: 'devices',
      handler: 'handoverDevice',
      showWhen: { field: 'assignedTo', op: 'ne', value: '' },
      prompts: [
        { name: 'to', label: '接班人', required: true },
        { name: 'note', label: '交接说明（校准状态自动生成快照）' }
      ]
    },
    {
      id: 'device-disable',
      label: '停用',
      collection: 'devices',
      danger: true,
      showWhen: { field: 'status', value: '在用' },
      guards: [{ left: 'item.assignedTo', op: 'empty', message: '设备未归还，不能停用' }],
      patches: [{ field: 'status', value: '停用' }]
    },
    {
      id: 'device-enable',
      label: '启用',
      collection: 'devices',
      showWhen: { field: 'status', value: '停用' },
      patches: [{ field: 'status', value: '在用' }]
    },
    {
      id: 'calibration-correct',
      label: '校准更正',
      collection: 'calibrations',
      handler: 'correctCalibration',
      prompts: [
        { name: 'result', label: '更正后结果', type: 'select', options: ['合格', '不合格'], required: true, prefill: 'result' },
        { name: 'validUntil', label: '有效期至', type: 'date', required: true, prefill: 'validUntil' },
        { name: 'note', label: '更正说明' }
      ]
    },
    {
      id: 'survey-alert',
      label: '标记异常',
      collection: 'surveys',
      showWhen: [{ field: 'admission', value: '有效' }, { field: 'status', op: 'ne', value: '异常待复查' }],
      guards: [{ left: 'item.admission', op: 'eq', right: '有效', message: '待复测巡测不计入异常，需先重测恢复' }],
      relation: { collection: 'sites', localKey: 'siteId' },
      patches: [
        { field: 'status', value: '异常待复查' },
        { target: 'related', field: 'protectedStatus', value: '重点保护' }
      ]
    },
    {
      id: 'survey-review',
      label: '完成复查',
      collection: 'surveys',
      showWhen: [{ field: 'status', value: '异常待复查' }, { field: 'admission', value: '有效' }],
      guards: [{ left: 'item.admission', op: 'eq', right: '有效', message: '待复测巡测不能复查，需先重测恢复' }],
      patches: [{ field: 'status', value: '已复查' }, { field: 'reviewNote', value: '异常已复核' }]
    },
    {
      id: 'survey-retest',
      label: '重测',
      collection: 'surveys',
      handler: 'retestSurvey',
      showWhen: { field: 'admission', value: '待复测' },
      prompts: [
        { name: 'deviceId', label: '重测设备', type: 'relation', collection: 'devices', labelFields: ['code', 'model'], required: true, prefill: 'deviceId' },
        { name: 'calibrationId', label: '校准记录', type: 'relation', collection: 'calibrations', labelFields: ['result', 'validUntil', 'calibratedAt'], required: true, prefill: 'calibrationId', dependsOn: { source: 'deviceId', match: 'deviceId' } },
        { name: 'temperature', label: '重测温度', type: 'number', prefill: 'temperature' },
        { name: 'humidity', label: '重测湿度', type: 'number', prefill: 'humidity' },
        { name: 'co2', label: '重测CO2', type: 'number', prefill: 'co2' },
        { name: 'note', label: '重测说明' }
      ]
    }
  ]
};
