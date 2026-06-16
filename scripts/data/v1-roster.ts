// V1 roster extracted verbatim from BUDGET_INITIAL_TEAM in
// tidelog-frontend/index.html (~line 13450). Do NOT edit by hand —
// re-extract from source if the roster changes.

export type V1RosterMember = {
  id?: number
  status: string
  name: string
  email?: string
  entity: string
  classification?: string
  dept: string
  role?: string
  location?: string
  ft?: string
  salary?: number
  bonus?: number
}

export const V1_ROSTER: V1RosterMember[] = [
  {id:1,status:'Current',name:'Aiden Aziz',email:'aiden@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Software Engineer',location:'US - Florida',ft:'FT',salary:170000,bonus:17000},
  {id:2,status:'Current',name:'Amina Ben Salem',email:'amina@orca.so',entity:'Opco',classification:'Contractor',dept:'Ops',role:'Technical Recruiter',location:'Spain',ft:'FT',salary:90000,bonus:9000},
  {id:3,status:'Current',name:'Bella Basuni (Basuni LLC)',email:'bella@orca.so',entity:'Zagreus',classification:'Contractor',dept:'Ops',role:'Operations Lead',location:'US - Georgia',ft:'FT',salary:150000,bonus:15000},
  {id:4,status:'Current',name:'Bradley Chong (Hafu Design Inc)',email:'brad@orca.so',entity:'Opco',classification:'Contractor',dept:'Product',role:'Product Designer',location:'Canada',ft:'FT',salary:120000,bonus:12000},
  {id:5,status:'Current',name:'Brenton Gunning',email:'brenton@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Engineer Manager',location:'US - Idaho',ft:'FT',salary:220000,bonus:22000},
  {id:6,status:'Current',name:'Caleb Northcott',email:'cnorthcott@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Software Engineer',location:'US - Florida',ft:'FT',salary:170000,bonus:17000},
  {id:7,status:'Current',name:'Calin Simon (Milonero B.V.)',email:'csimon@orca.so',entity:'Juku',classification:'Contractor',dept:'Engineering',role:'Software Engineer (DA)',location:'Netherlands',ft:'FT',salary:170000,bonus:17000},
  {id:8,status:'Current',name:'Canberk Kandemir',email:'canberk@orca.so',entity:'Juku',classification:'Contractor',dept:'Engineering',role:'AI Engineer',location:'Canada',ft:'FT',salary:170000,bonus:17000},
  {id:9,status:'Current',name:'Casey-Leigh Charlesworth',email:'casey@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Software Engineer',location:'US - California',ft:'FT',salary:165000,bonus:16500},
  {id:10,status:'Current',name:'Christopher Montagano (Tags)',email:'montagano@orca.so',entity:'Zagreus',classification:'Contractor',dept:'Legal',role:'CLO',location:'US - Utah',ft:'FT',salary:370000,bonus:37000},
  {id:11,status:'Current',name:'Daniel Cavagnino',email:'daniel@orca.so',entity:'Opco',classification:'Contractor',dept:'Product',role:'Research Operations Specialist',location:'Australia',ft:'FT',salary:70000,bonus:7000},
  {id:12,status:'Current',name:'Gustavo Sabino',email:'gustavo@orca.so',entity:'Opco',classification:'Contractor',dept:'Finance',role:'Bookkeeper',location:'Portugal',ft:'FT',salary:60000,bonus:6000},
  {id:13,status:'Current',name:'Ha Vu',email:'ha@orca.so',entity:'Opco',classification:'Contractor',dept:'Product',role:'Community Support',location:'Vietnam',ft:'FT',salary:25000,bonus:2500},
  {id:14,status:'Current',name:'Hyunsik Boo (Boosik)',email:'boosik@orca.so',entity:'Opco',classification:'Contractor',dept:'Engineering',role:'Developer Advocate',location:'South Korea',ft:'FT',salary:130000,bonus:13000},
  {id:15,status:'Current',name:'Isaac Kim',email:'isaac@orca.so',entity:'Zagreus',classification:'Employee',dept:'Ops',role:'COO',location:'US - Georgia',ft:'FT',salary:255000,bonus:25500},
  {id:16,status:'Current',name:'Jacob Shiohira',email:'jacob@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Software Engineer',location:'US - Arkansas',ft:'FT',salary:190000,bonus:19000},
  {id:17,status:'Current',name:'James Waldorf-Nicol (Capten)',email:'mwnci@orca.so',entity:'Opco',classification:'Contractor',dept:'Product',role:'Community Manager',location:'UK',ft:'FT',salary:80000,bonus:8000},
  {id:18,status:'Current',name:'Jonathan Avery',email:'jonathan@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Staff Engineer',location:'US - Tennessee',ft:'FT',salary:220000,bonus:22000},
  {id:19,status:'Current',name:'Jose Preciado Perez',email:'jose@orca.so',entity:'Opco',classification:'Contractor',dept:'Legal',role:'Legal Clerk',location:'Panama',ft:'FT',salary:81000,bonus:8100},
  {id:20,status:'Current',name:'Josh Doyle',email:'jdoyle@orca.so',entity:'Opco',classification:'Contractor',dept:'Product',role:'Community Support',location:'UK',ft:'FT',salary:42000,bonus:4200},
  {id:21,status:'Current',name:'Josh Guha',email:'jguha@orca.so',entity:'Juku',classification:'Contractor',dept:'Engineering',role:'Software Engineer',location:'UK (London)',ft:'FT',salary:185000,bonus:18500},
  {id:22,status:'Current',name:'Kate San (SEAVest MM Ltd)',email:'kate@orca.so',entity:'Opco',classification:'Contractor',dept:'Finance',role:'Finance Manager',location:'US - NYC',ft:'FT',salary:150000,bonus:15000},
  {id:23,status:'Current',name:'Kian Ghalibaf (Pangea3)',email:'kian@orca.so',entity:'Zagreus',classification:'Contractor',dept:'Business Development',role:'Head of BD',location:'US - Texas',ft:'FT',salary:175000,bonus:17500},
  {id:24,status:'Current',name:'Matias Castro',email:'mcastro@orca.so',entity:'Zagreus',classification:'Employee',dept:'Product',role:'Head of Product Management',location:'US - Florida',ft:'FT',salary:220000,bonus:22000},
  {id:25,status:'Current',name:'Matthew Thiery',email:'matthew@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Software Engineer',location:'US - Virginia',ft:'FT',salary:190000,bonus:19000},
  {id:26,status:'Current',name:'Michael Hwang (TMOC Labs)',email:'michael@orca.so',entity:'Zagreus',classification:'Contractor',dept:'General',role:'CEO',location:'US - Las Vegas',ft:'FT',salary:235000,bonus:23500},
  {id:27,status:'Current',name:'Mike Yoo (Mikey)',email:'mikeyoo@orca.so',entity:'Opco',classification:'Contractor',dept:'Product',role:'Product Operations',location:'South Korea',ft:'FT',salary:70000,bonus:7000},
  {id:28,status:'Current',name:'Otto Cheung',email:'otto@orca.so',entity:'Juku',classification:'Contractor',dept:'Engineering',role:'Head of Engineering',location:'Canada',ft:'FT',salary:255000,bonus:25500},
  {id:29,status:'Current',name:'Raphaela Schiefersteiner',email:'raphaela@orca.so',entity:'Opco',classification:'Contractor',dept:'Product',role:'Head of Product Insights',location:'Austria',ft:'FT',salary:175000,bonus:17500},
  {id:30,status:'Current',name:'Riku Iwanaga',email:'riwanaga@orca.so',entity:'Opco',classification:'Contractor',dept:'Business Development',role:'BD',location:'Malaysia',ft:'FT',salary:80000,bonus:8000},
  {id:31,status:'Current',name:'Sakae Kawakami (Yugure)',email:'skawakami@orca.so',entity:'Juku',classification:'Contractor',dept:'Engineering',role:'Software Engineer',location:'Japan',ft:'FT',salary:200000,bonus:20000},
  {id:32,status:'Current',name:'Sam Parhimchik',email:'sparhimchik@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Engineering Manager',location:'US - Florida',ft:'FT',salary:180000,bonus:18000},
  {id:33,status:'Current',name:'Sandesh Ragati',email:'sandesh@orca.so',entity:'Opco',classification:'Contractor',dept:'Product',role:'Product Manager',location:'UK (London)',ft:'FT',salary:185000,bonus:18500},
  {id:34,status:'Current',name:'Sangyun Ock',email:'sangyun@orca.so',entity:'Opco',classification:'Contractor',dept:'Engineering',role:'Software Engineer',location:'South Korea',ft:'FT',salary:110000,bonus:11000},
  {id:35,status:'Current',name:'Toricruz Mendiola',email:'tori@orca.so',entity:'Zagreus',classification:'Employee',dept:'Marketing',role:'Social Media Manager',location:'US - California',ft:'FT',salary:65000,bonus:6500},
  {id:36,status:'Current',name:'Tyler Lowmiller',email:'tlowmiller@orca.so',entity:'Zagreus',classification:'Employee',dept:'Product',role:'Product Designer',location:'US - NYC',ft:'FT',salary:145000,bonus:14500},
  {id:37,status:'Current',name:'Will Thieme',email:'wjthieme@orca.so',entity:'Opco',classification:'Contractor',dept:'Engineering',role:'Head of Engineering',location:'Panama',ft:'FT',salary:255000,bonus:25500},
  {id:38,status:'Current',name:'Yibo Ding',email:'yibo@orca.so',entity:'Opco',classification:'Contractor',dept:'Business Development',role:'BD',location:'China',ft:'PT',salary:20000,bonus:2000},
  {id:39,status:'Current',name:'Zach Choi',email:'zach@orca.so',entity:'Zagreus',classification:'Employee',dept:'Engineering',role:'Engineering Manager',location:'US - NYC',ft:'FT',salary:225000,bonus:22500},
  {id:40,status:'Current',name:'Zizheng Jiang (Zed)',email:'zed@orca.so',entity:'Opco',classification:'Contractor',dept:'Engineering',role:'Software Engineer',location:'Canada',ft:'FT',salary:180000,bonus:18000},
  {id:41,status:'Current',name:'Rebecca Lara',email:'rlara@orca.so',entity:'Zagreus',classification:'Contractor',dept:'Finance',role:'Head of Finance',location:'US - New Jersey',ft:'FT',salary:235000,bonus:23500},
  {id:42,status:'Current',name:'Nina Ilagan',email:'nina@orca.so',entity:'Opco',classification:'Contractor',dept:'Finance',role:'Bookkeeper',location:'Philippines',ft:'FT',salary:30000,bonus:3000},
]
