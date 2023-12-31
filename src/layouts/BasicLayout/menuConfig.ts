const headerMenuConfig = [];

const asideMenuConfig = [
  {
    name: '通用计算工具',
    path: '/common',
    icon: 'chart-bar'
  },
  {
    name: '金融类计算工具',
    path: '/',
    icon: 'chart-pie',
    children: [
      {
        name: '货币、固收类',
        path: '/finance/monetary'
      },
      {
        name: '债券类',
        path: '/finance/bond'
      },
      {
        name: '股票类',
        path: '/finance/stock'
      },
      {
        name: '期货类',
        path: '/finance/future'
      }
    ]
  },
  {
    name: '程序员',
    path: '/',
    icon: 'account',
    children: [
      {
        name: '编解码类',
        path: '/code/encoding'
      }
    ]
  },
];

export { headerMenuConfig, asideMenuConfig };
