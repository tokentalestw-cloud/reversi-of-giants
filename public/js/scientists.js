// 科學家角色棋子資料
// target: 'legal' = 必須是一般合法落子位置；'empty' = 任意空格；'enemy' = 敵方棋子（角落除外）
export const SCIENTISTS = [
  {
    id: 'newton', name: '艾薩克·牛頓', short: '牛頓', en: 'Isaac Newton', years: '1643–1727',
    field: '古典力學・萬有引力', skill: '萬有引力', target: 'legal', color: '#ffb347',
    desc: '一般落子後產生引力場，把上下左右緊鄰的敵方棋子「拉」進己方陣營並翻轉。',
    quote: '如果說我看得比別人更遠，那是因為我站在巨人的肩膀上。',
  },
  {
    id: 'einstein', name: '阿爾伯特·愛因斯坦', short: '愛因斯坦', en: 'Albert Einstein', years: '1879–1955',
    field: '相對論', skill: '時間膨脹', target: 'legal', color: '#b388ff',
    desc: '一般落子後扭曲時空，對手的時間變慢——你立刻再行動一回合。',
    quote: '想像力比知識更重要。',
  },
  {
    id: 'curie', name: '瑪麗·居禮', short: '居禮夫人', en: 'Marie Curie', years: '1867–1934',
    field: '放射性・化學', skill: '放射性衰變', target: 'legal', color: '#7cff6b',
    desc: '一般落子後釋放輻射，周圍 2 格內隨機最多 3 枚敵方棋子發生「衰變」而翻轉。',
    quote: '生活中沒有什麼可怕的東西，只有需要理解的東西。',
  },
  {
    id: 'tesla', name: '尼古拉·特斯拉', short: '特斯拉', en: 'Nikola Tesla', years: '1856–1943',
    field: '電機工程・交流電', skill: '特斯拉線圈', target: 'legal', color: '#4fc3ff',
    desc: '一般落子後放出連鎖閃電：每次跳向 2 格內最近的敵子並翻轉，最多連鎖 4 次。',
    quote: '若想發現宇宙的秘密，就用能量、頻率與振動去思考。',
  },
  {
    id: 'faraday', name: '麥可·法拉第', short: '法拉第', en: 'Michael Faraday', years: '1791–1867',
    field: '電磁學', skill: '法拉第籠', target: 'legal', color: '#40e0d0',
    desc: '一般落子後，落點 3×3 範圍內的己方棋子罩上電磁屏蔽，對手接下來 2 回合無法以任何方式翻轉或移除它們。',
    quote: '只要符合自然法則，沒有什麼奇妙到不可能是真的。',
  },
  {
    id: 'hawking', name: '史蒂芬·霍金', short: '霍金', en: 'Stephen Hawking', years: '1942–2018',
    field: '宇宙學・黑洞', skill: '黑洞', target: 'empty', color: '#ff6a3d',
    desc: '在任意空格製造永久黑洞（之後無人能落子，並會阻斷夾擊連線），同時吞噬周圍 8 格的敵方棋子。',
    quote: '記得仰望星空，而不是低頭看腳下。',
  },
  {
    id: 'turing', name: '艾倫·圖靈', short: '圖靈', en: 'Alan Turing', years: '1912–1954',
    field: '計算機科學・密碼學', skill: '密碼破譯', target: 'enemy', color: '#00ff9c',
    desc: '破譯一枚敵方棋子（角落除外）使其倒戈成為己方，並以它為起點進行夾擊翻轉。',
    quote: '我們只能看到前方不遠處，但能看到那裡有很多事要做。',
  },
  {
    id: 'schrodinger', name: '埃爾溫·薛丁格', short: '薛丁格', en: 'Erwin Schrödinger', years: '1887–1961',
    field: '量子力學', skill: '量子疊加', target: 'empty', color: '#ff4fd8',
    desc: '在任意空格放下疊加態棋子，觀測後坍縮：50% 成為己方，夾擊翻轉並連同周圍 8 格敵子一起翻轉；50% 坍縮成對手的棋子。',
    quote: '重要的不是看見別人沒看見的，而是對人人都看見的事物，想到別人沒想到的。',
  },
  {
    id: 'darwin', name: '查爾斯·達爾文', short: '達爾文', en: 'Charles Darwin', years: '1809–1882',
    field: '演化生物學', skill: '天擇', target: 'legal', color: '#9be15d',
    desc: '一般落子後啟動天擇：全盤上周圍 8 格中有 5 枚以上己方棋子的敵子，因無法適應而被同化翻轉。',
    quote: '生命如是之觀，何等壯麗恢弘。',
  },
  {
    id: 'mabaoguo', name: '馬保國', short: '馬保國', en: 'Master Ma Baoguo', years: '1952–',
    field: '渾元形意太極門・傳統功夫', skill: '閃電五連鞭', target: 'legal', color: '#ffe14d',
    desc: '一般落子後施展渾元勁「閃電五連鞭」：連續揮出五記金雷鞭擊，每次隨機抽打距離落點 3 格內的 1 枚敵方棋子使其翻轉（最多連抽 5 枚）！',
    quote: '年輕人不講武德，耗子尾汁！看我閃電五連鞭！',
  },
  {
    id: 'trump', name: '唐納·川普', short: '川普', en: 'Donald Trump', years: '1946–',
    field: '美國總統・關稅與築牆', skill: '關稅壁壘', target: 'legal', color: '#ff9d2e',
    desc: '一般落子後啟動「超級關稅與築牆」：強制徵收棋盤外圍邊線上的敵方棋子（最多 3 枚；若邊線無敵子則改徵收全盤最多 2 枚）翻轉為己方，並為落點與徵收棋子築起金色護牆保護 1 回合！',
    quote: '我們要築起一道美麗的高牆，而且要讓對手買單！Make Reversi Great Again!',
  },
  {
    id: 'liuzhenren', name: '劉真人', short: '劉真人', en: 'True-Heart Immortal Liu', years: '真情男子漢',
    field: '真情・專情・用心・負責', skill: '真情天罰', target: 'legal', color: '#ff3864',
    desc: '真情男子漢，專門降天罰處罰對感情不忠的負心漢！一般落子後降下「真情・專情・用心・負責」四道九天雷罰，審判場上曾變心翻面過或左擁右抱的不忠敵子（最多 4 枚）劈回己方，且自身堅守專情護盾 2 回合絕不變心！',
    quote: '真情、專情、用心、負責！凡對感情不忠的負心漢，必降天罰！',
  },
];

const MAP = Object.fromEntries(SCIENTISTS.map(s => [s.id, s]));
export const getScientist = id => MAP[id];
export const portraitUrl = id => `assets/portraits/${id}.jpg`;
