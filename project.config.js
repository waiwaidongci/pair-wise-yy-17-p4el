module.exports = {
  port: 3912,
  title: '钟乳石洞穴微环境巡测',
  lede: '巡测准入闭环：每次巡测绑定当次设备与有效校准记录，校准过期、停用或量程不符只留档待复测；设备未归还不能再分配，换班连同校准状态交接；校准更正后未复核巡测失效，重测合格方可恢复。',
  tones: {
    '常规观察': 'ok',
    '正常': 'ok',
    '已复查': 'ok',
    '合格': 'ok',
    '在库': 'ok',
    '重点保护': 'warn',
    '借出': 'warn',
    '异常待复查': 'bad',
    '暂停开放': 'bad',
    '停用': 'bad',
    '不合格': 'bad',
    '留档待复测': 'hold'
  },
  collections: {
    sites: { label: '样点档案' },
    devices: { label: '设备台账' },
    calibrations: { label: '校准记录' },
    surveys: { label: '巡测记录' }
  },
  stats: [
    { label: '样点', collection: 'sites' },
    { label: '重点保护', collection: 'sites', filter: { field: 'protectedStatus', value: '重点保护' } },
    { label: '巡测记录', collection: 'surveys' },
    { label: '待复查', collection: 'surveys', filter: { field: 'status', value: '异常待复查' } },
    { label: '待复测(不计异常)', collection: 'surveys', filter: { field: 'status', value: '留档待复测' } },
    { label: '借出设备', collection: 'devices', filter: { field: 'status', value: '借出' } }
  ],
  views: [
    {
      id: 'dashboard',
      label: '趋势看板',
      type: 'dashboard',
      focuses: [
        { title: '异常与复查', collection: 'surveys', field: 'status', values: ['异常待复查'], limit: 8 },
        { title: '留档待复测（不进入异常统计）', collection: 'surveys', field: 'status', values: ['留档待复测'], limit: 8 }
      ]
    },
    {
      id: 'surveys',
      label: '巡测记录',
      collection: 'surveys',
      formTitle: '登记巡测',
      listTitle: '巡测历史',
      submitLabel: '保存巡测',
      idempotency: true,
      searchPlaceholder: '搜索人员、干扰痕迹、照片',
      searchFields: ['surveyor', 'disturbance', 'photoUrl'],
      statusField: 'status',
      statusOptions: ['正常', '异常待复查', '已复查', '留档待复测'],
      titleFields: ['surveyor', 'date'],
      relation: { collection: 'sites', localKey: 'siteId', labelFields: ['cave', 'zone', 'pointCode'] },
      summaryFields: ['disturbance', 'reviewNote', 'holdReason'],
      detailFields: [
        { label: '温度', name: 'temperature' },
        { label: '湿度', name: 'humidity' },
        { label: 'CO2', name: 'co2' },
        { label: '当次设备', name: 'deviceId', type: 'relation', collection: 'devices', labelFields: ['code', 'name'] },
        { label: '校准记录', name: 'calibrationId', type: 'relation', collection: 'calibrations', labelFields: ['deviceCode', 'certificateNo'] }
      ],
      defaults: { reviewNote: '' },
      fields: [
        { label: '样点', name: 'siteId', type: 'relation', collection: 'sites', labelFields: ['cave', 'zone', 'pointCode'], required: true, wide: true },
        { label: '当次设备', name: 'deviceId', type: 'relation', collection: 'devices', labelFields: ['code', 'name'], required: true, wide: true },
        { label: '校准记录', name: 'calibrationId', type: 'relation', collection: 'calibrations', labelFields: ['deviceCode', 'certificateNo', 'validUntil', 'result'], required: true, wide: true, filterLink: { form: 'deviceId', field: 'deviceId' } },
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
      formTitle: '登记设备',
      listTitle: '设备列表',
      submitLabel: '保存设备',
      searchPlaceholder: '搜索编号、名称、持有人',
      searchFields: ['code', 'name', 'holder'],
      statusField: 'status',
      statusOptions: ['在库', '借出', '停用'],
      titleFields: ['code', 'name'],
      summaryFields: ['note'],
      detailFields: [
        { label: '类型', name: 'type' },
        { label: '当前持有人', name: 'holder' },
        { label: '最新校准', name: 'calibrationLabel' },
        { label: '温度量程', combine: ['tempMin', 'tempMax'], sep: ' ~ ' },
        { label: '湿度量程', combine: ['humMin', 'humMax'], sep: ' ~ ' },
        { label: 'CO2量程', combine: ['co2Min', 'co2Max'], sep: ' ~ ' }
      ],
      defaults: { status: '在库', holder: '' },
      fields: [
        { label: '设备编号', name: 'code', required: true },
        { label: '设备名称', name: 'name', required: true },
        { label: '类型', name: 'type', type: 'select', options: ['多参数', '温湿度', 'CO2'] },
        { label: '状态', name: 'status', type: 'select', options: ['在库', '借出', '停用'] },
        { label: '温度量程下限', name: 'tempMin', type: 'number', required: true },
        { label: '温度量程上限', name: 'tempMax', type: 'number', required: true },
        { label: '湿度量程下限', name: 'humMin', type: 'number', required: true },
        { label: '湿度量程上限', name: 'humMax', type: 'number', required: true },
        { label: 'CO2量程下限', name: 'co2Min', type: 'number', required: true },
        { label: 'CO2量程上限', name: 'co2Max', type: 'number', required: true },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'calibrations',
      label: '校准记录',
      collection: 'calibrations',
      formTitle: '登记校准',
      listTitle: '校准记录列表',
      submitLabel: '保存校准',
      searchPlaceholder: '搜索证书编号、机构、设备',
      searchFields: ['certificateNo', 'agency', 'deviceCode'],
      statusField: 'result',
      statusOptions: ['合格', '不合格'],
      titleFields: ['certificateNo', 'deviceCode'],
      summaryFields: ['note'],
      detailFields: [
        { label: '校准机构', name: 'agency' },
        { label: '校准日期', name: 'calibratedAt' },
        { label: '有效期至', name: 'validUntil' },
        { label: '当前有效性', name: 'validityLabel' }
      ],
      fields: [
        { label: '设备', name: 'deviceId', type: 'relation', collection: 'devices', labelFields: ['code', 'name'], required: true, wide: true },
        { label: '证书编号', name: 'certificateNo', required: true },
        { label: '校准机构', name: 'agency', required: true },
        { label: '校准日期', name: 'calibratedAt', type: 'date', required: true },
        { label: '有效期至', name: 'validUntil', type: 'date', required: true },
        { label: '校准结果', name: 'result', type: 'select', options: ['合格', '不合格'] },
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
      id: 'survey-alert',
      label: '标记异常',
      collection: 'surveys',
      relation: { collection: 'sites', localKey: 'siteId' },
      guards: [
        { left: 'item.status', op: 'neq', right: '留档待复测', message: '留档待复测记录不能标记异常，需先重测恢复' },
        { left: 'item.status', op: 'neq', right: '已复查', message: '已复查记录无需再次标记' }
      ],
      patches: [
        { field: 'status', value: '异常待复查' },
        { target: 'related', field: 'protectedStatus', value: '重点保护' }
      ]
    },
    {
      id: 'survey-review',
      label: '完成复查',
      collection: 'surveys',
      guards: [{ left: 'item.status', op: 'eq', right: '异常待复查', message: '仅异常待复查记录可完成复查' }],
      patches: [{ field: 'status', value: '已复查' }, { field: 'reviewNote', value: '异常已复核' }]
    },
    {
      id: 'device-assign',
      label: '分配领用',
      collection: 'devices',
      op: 'assign',
      when: { field: 'status', in: ['在库'] },
      params: [{ name: 'holder', label: '领用人', required: true }]
    },
    {
      id: 'device-return',
      label: '归还入库',
      collection: 'devices',
      op: 'return',
      when: { field: 'status', in: ['借出'] }
    },
    {
      id: 'device-handover',
      label: '换班交接',
      collection: 'devices',
      op: 'handover',
      when: { field: 'status', in: ['借出'] },
      params: [
        { name: 'to', label: '接班人', required: true },
        { name: 'note', label: '交接备注' }
      ]
    },
    {
      id: 'calibration-correct',
      label: '校准更正',
      collection: 'calibrations',
      op: 'correct',
      params: [
        { name: 'result', label: '更正后结果', type: 'select', options: ['合格', '不合格'], required: true },
        { name: 'validUntil', label: '有效期至', type: 'date', required: true },
        { name: 'note', label: '更正说明' }
      ]
    },
    {
      id: 'survey-retest',
      label: '重测',
      collection: 'surveys',
      op: 'retest',
      when: { field: 'status', in: ['留档待复测'] },
      params: [
        { name: 'calibrationId', label: '校准记录（可改绑，留空保持不变）', type: 'relation', collection: 'calibrations', labelFields: ['deviceCode', 'certificateNo', 'validUntil', 'result'], filterField: 'deviceId', filterItem: 'deviceId' },
        { name: 'note', label: '重测说明' }
      ]
    }
  ]
};
