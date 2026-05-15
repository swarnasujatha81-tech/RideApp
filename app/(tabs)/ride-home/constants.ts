import { Dimensions } from 'react-native';
import type { Coord } from './types';

export const SCREEN_HEIGHT = Dimensions.get('window').height;
export const SCREEN_WIDTH = Dimensions.get('window').width;
export const CURRENT_LOC_FAB_RISE = Math.round(Dimensions.get('window').height * 0.1);
export const ACTIVE_RIDE_BUTTON_WIDTH = 140;
export const ACTIVE_RIDE_BUTTON_HEIGHT = 48;
export const DRIVER_SUBSCRIPTION_AMOUNT = 10;
export const DRIVER_SUBSCRIPTION_DAYS = 28;
export const RAZORPAY_KEY_ID = 'rzp_test_SlamQeH59EZ2yd';
export const EARN_REWARD_AMOUNT = 5;
export const icons = { Bike: '🏍️', Cycle: '🚲', Auto: '🛺', Cab: '🚕', ShareAuto: '👥', Parcel: '📦' };
export const FIVE_MIN_MS = 5 * 60 * 1000;
export const HYDERABAD_CENTER: Coord = { latitude: 17.385, longitude: 78.4867 };
export const HYDERABAD_SERVICE_RADIUS_KM = 40;
export const HYDERABAD_POPULAR_AREA_POINTS: { name: string; coord: Coord }[] = [
  { name: 'Ameerpet', coord: { latitude: 17.4375, longitude: 78.4483 } },
  { name: 'Erragadda', coord: { latitude: 17.4583, longitude: 78.4220 } },
  { name: 'Miyapur', coord: { latitude: 17.4960, longitude: 78.3578 } },
  { name: 'KPHB', coord: { latitude: 17.4948, longitude: 78.3996 } },
  { name: 'Kukatpally', coord: { latitude: 17.4850, longitude: 78.4138 } },
  { name: 'Balanagar', coord: { latitude: 17.4766, longitude: 78.4486 } },
  { name: 'Moosapet', coord: { latitude: 17.4686, longitude: 78.4302 } },
  { name: 'Bharat Nagar', coord: { latitude: 17.4810, longitude: 78.4050 } },
  { name: 'SR Nagar', coord: { latitude: 17.4300, longitude: 78.4225 } },
  { name: 'Khairatabad', coord: { latitude: 17.4048, longitude: 78.4590 } },
  { name: 'Lakdi-ka-pul', coord: { latitude: 17.3987, longitude: 78.4899 } },
  { name: 'Nampally', coord: { latitude: 17.3920, longitude: 78.4678 } },
  { name: 'Gandhi Bhavan', coord: { latitude: 17.4001, longitude: 78.4748 } },
  { name: 'Osmania Medical College', coord: { latitude: 17.4150, longitude: 78.4788 } },
  { name: 'MG Bus Station', coord: { latitude: 17.4258, longitude: 78.4485 } },
  { name: 'Malakpet', coord: { latitude: 17.3731, longitude: 78.5022 } },
  { name: 'Dilsukhnagar', coord: { latitude: 17.3688, longitude: 78.5247 } },
  { name: 'Chaitanyapuri', coord: { latitude: 17.3556, longitude: 78.5186 } },
  { name: 'LB Nagar', coord: { latitude: 17.3457, longitude: 78.5522 } },
  { name: 'Nagole', coord: { latitude: 17.3641, longitude: 78.5556 } },
  { name: 'Uppal', coord: { latitude: 17.4058, longitude: 78.5591 } },
  { name: 'Tarnaka', coord: { latitude: 17.4286, longitude: 78.5382 } },
  { name: 'Mettuguda', coord: { latitude: 17.4170, longitude: 78.5290 } },
  { name: 'Secunderabad East', coord: { latitude: 17.4537, longitude: 78.5000 } },
  { name: 'Parade Ground', coord: { latitude: 17.4430, longitude: 78.4913 } },
  { name: 'Paradise', coord: { latitude: 17.3968, longitude: 78.4738 } },
  { name: 'Prakash Nagar', coord: { latitude: 17.4395, longitude: 78.4887 } },
  { name: 'Madhura Nagar', coord: { latitude: 17.4515, longitude: 78.4979 } },
  { name: 'Yusufguda', coord: { latitude: 17.4527, longitude: 78.4923 } },
  { name: 'Jubilee Hills Check Post', coord: { latitude: 17.4310, longitude: 78.4118 } },
  { name: 'Peddamma Temple', coord: { latitude: 17.4250, longitude: 78.4072 } },
  { name: 'Raidurg', coord: { latitude: 17.4250, longitude: 78.3872 } },
  { name: 'Musheerabad', coord: { latitude: 17.4433, longitude: 78.5112 } },
  { name: 'RTC Cross Roads', coord: { latitude: 17.4153, longitude: 78.4481 } },
  { name: 'Narayanguda', coord: { latitude: 17.4031, longitude: 78.5056 } },
  { name: 'Sultan Bazaar', coord: { latitude: 17.3865, longitude: 78.4830 } },
  { name: 'Financial District', coord: { latitude: 17.4311, longitude: 78.3875 } },
  { name: 'Nanakramguda', coord: { latitude: 17.4562, longitude: 78.3577 } },
  { name: 'Kothaguda', coord: { latitude: 17.4484, longitude: 78.3870 } },
  { name: 'Shilparamam', coord: { latitude: 17.4382, longitude: 78.3999 } },
  { name: 'Lingampally', coord: { latitude: 17.4870, longitude: 78.3777 } },
  { name: 'Nalagandla', coord: { latitude: 17.4327, longitude: 78.3785 } },
  { name: 'Chandanagar', coord: { latitude: 17.4852, longitude: 78.3322 } },
  { name: 'Patancheru', coord: { latitude: 17.4849, longitude: 78.1686 } },
  { name: 'Isnapur', coord: { latitude: 17.4299, longitude: 78.2952 } },
  { name: 'Mehdipatnam', coord: { latitude: 17.3950, longitude: 78.4325 } },
  { name: 'Attapur', coord: { latitude: 17.3675, longitude: 78.4295 } },
  { name: 'Hyderguda', coord: { latitude: 17.3989, longitude: 78.4764 } },
  { name: 'Shaikpet', coord: { latitude: 17.3901, longitude: 78.4138 } },
  { name: 'Manikonda', coord: { latitude: 17.4377, longitude: 78.3905 } },
  { name: 'Puppalaguda', coord: { latitude: 17.3720, longitude: 78.3983 } },
  { name: 'Masab Tank', coord: { latitude: 17.4217, longitude: 78.4724 } },
  { name: 'NMDC', coord: { latitude: 17.4267, longitude: 78.4074 } },
  { name: 'Asif Nagar', coord: { latitude: 17.4069, longitude: 78.4141 } },
  { name: 'Gudimalkapur', coord: { latitude: 17.3830, longitude: 78.4563 } },
  { name: 'Charminar', coord: { latitude: 17.3616, longitude: 78.4747 } },
  { name: 'Shalibanda', coord: { latitude: 17.3601, longitude: 78.4790 } },
  { name: 'Falaknuma', coord: { latitude: 17.3665, longitude: 78.4750 } },
  { name: 'Chandrayangutta', coord: { latitude: 17.3470, longitude: 78.4830 } },
  { name: 'Uppuguda', coord: { latitude: 17.3591, longitude: 78.4922 } },
  { name: 'Bahadurpura', coord: { latitude: 17.3634, longitude: 78.4836 } },
  { name: 'Amberpet', coord: { latitude: 17.3990, longitude: 78.5030 } },
  { name: 'Golnaka', coord: { latitude: 17.4052, longitude: 78.5201 } },
  { name: 'Adikmet', coord: { latitude: 17.3995, longitude: 78.4970 } },
  { name: 'Vidyanagar', coord: { latitude: 17.4327, longitude: 78.4672 } },
  { name: 'Barkatpura', coord: { latitude: 17.3950, longitude: 78.5000 } },
  { name: 'Kothapet', coord: { latitude: 17.3668, longitude: 78.5169 } },
  { name: 'Saroornagar', coord: { latitude: 17.3520, longitude: 78.5406 } },
  { name: 'Champapet', coord: { latitude: 17.3461, longitude: 78.5230 } },
  { name: 'BN Reddy Nagar', coord: { latitude: 17.3684, longitude: 78.5185 } },
  { name: 'Vanasthalipuram', coord: { latitude: 17.3257, longitude: 78.5369 } },
  { name: 'Hayathnagar', coord: { latitude: 17.3174, longitude: 78.5477 } },
  { name: 'Alwal', coord: { latitude: 17.5000, longitude: 78.5143 } },
  { name: 'Tirumalagiri', coord: { latitude: 17.4516, longitude: 78.4930 } },
  { name: 'Bolarum', coord: { latitude: 17.5063, longitude: 78.5333 } },
  { name: 'Suchitra', coord: { latitude: 17.4841, longitude: 78.4294 } },
  { name: 'Jeedimetla', coord: { latitude: 17.4873, longitude: 78.4055 } },
  { name: 'Kompally', coord: { latitude: 17.5506, longitude: 78.4298 } },
  { name: 'Medchal', coord: { latitude: 17.5937, longitude: 78.4318 } },
  { name: 'Sarath City Capital Mall', coord: { latitude: 17.4493, longitude: 78.3349 } },
  { name: 'Inorbit Mall', coord: { latitude: 17.4571, longitude: 78.3561 } },
  { name: 'Forum Sujana Mall', coord: { latitude: 17.4479, longitude: 78.3801 } },
  { name: 'GVK One Mall', coord: { latitude: 17.4424, longitude: 78.4067 } },
  { name: 'Next Galleria Mall', coord: { latitude: 17.4325, longitude: 78.4114 } },
  { name: 'Irrum Manzil Galleria Mall', coord: { latitude: 17.4325, longitude: 78.4505 } },
  { name: 'Central Mall Punjagutta', coord: { latitude: 17.4300, longitude: 78.4530 } },
  { name: 'City Center Mall', coord: { latitude: 17.4570, longitude: 78.3688 } },
  { name: 'Manjeera Mall', coord: { latitude: 17.4446, longitude: 78.3993 } },
  { name: 'Asian Cine Square Mall', coord: { latitude: 17.4401, longitude: 78.3869 } },
  { name: 'CMR Central Mall', coord: { latitude: 17.4494, longitude: 78.3824 } },
  { name: 'South India Shopping Mall', coord: { latitude: 17.4108, longitude: 78.4097 } },
  { name: 'Rainbow Children\'s Hospital Banjara Hills', coord: { latitude: 17.4142, longitude: 78.4413 } },
  { name: 'Yashoda Hospitals Secunderabad', coord: { latitude: 17.4390, longitude: 78.5090 } },
  { name: 'KIMS Hospitals Secunderabad', coord: { latitude: 17.4322, longitude: 78.5069 } },
  { name: 'Continental Hospitals Gachibowli', coord: { latitude: 17.4422, longitude: 78.3522 } },
  { name: 'AIG Hospitals Gachibowli', coord: { latitude: 17.4299, longitude: 78.3364 } },
  { name: 'Sunshine Hospitals Secunderabad', coord: { latitude: 17.4551, longitude: 78.5164 } },
  { name: 'Global Hospitals Lakdikapul', coord: { latitude: 17.4068, longitude: 78.4891 } },
  { name: 'Osmania General Hospital', coord: { latitude: 17.4159, longitude: 78.4827 } },
  { name: 'NIMS Hospital Punjagutta', coord: { latitude: 17.4318, longitude: 78.4451 } },
  { name: 'KBR National Park', coord: { latitude: 17.4370, longitude: 78.4099 } },
  { name: 'Lumbini Park', coord: { latitude: 17.4324, longitude: 78.4174 } },
  { name: 'Sanjeevaiah Park', coord: { latitude: 17.4318, longitude: 78.4165 } },
  { name: 'NTR Gardens', coord: { latitude: 17.4235, longitude: 78.4124 } },
  { name: 'Indira Park', coord: { latitude: 17.4180, longitude: 78.4781 } },
  { name: 'Jalagam Vengal Rao Park', coord: { latitude: 17.3982, longitude: 78.4015 } },
  { name: 'Krishna Kanth Park', coord: { latitude: 17.4391, longitude: 78.3856 } },
  { name: 'Public Gardens Hyderabad', coord: { latitude: 17.3875, longitude: 78.4767 } },
  { name: 'Nehru Zoological Park', coord: { latitude: 17.3936, longitude: 78.4436 } },
  { name: 'Secunderabad Junction railway station', coord: { latitude: 17.4397, longitude: 78.4986 } },
  { name: 'Hyderabad Deccan railway station', coord: { latitude: 17.3882, longitude: 78.4867 } },
  { name: 'Kacheguda railway station', coord: { latitude: 17.3775, longitude: 78.5036 } },
  { name: 'Lingampalli railway station', coord: { latitude: 17.5015, longitude: 78.3706 } },
  { name: 'Hafeezpet railway station', coord: { latitude: 17.4505, longitude: 78.3660 } },
  { name: 'Hi-Tech City railway station', coord: { latitude: 17.4477, longitude: 78.3796 } },
  { name: 'Borabanda railway station', coord: { latitude: 17.5010, longitude: 78.3916 } },
  { name: 'Sanat Nagar railway station', coord: { latitude: 17.3997, longitude: 78.4778 } },
  { name: 'Fateh Nagar railway station', coord: { latitude: 17.4761, longitude: 78.4018 } },
  { name: 'Nature Cure Hospital railway station', coord: { latitude: 17.4140, longitude: 78.4540 } },
  { name: 'Yakutpura railway station', coord: { latitude: 17.3736, longitude: 78.4871 } },
  { name: 'Dabirpura railway station', coord: { latitude: 17.3833, longitude: 78.4986 } },
  { name: 'Malakpet railway station', coord: { latitude: 17.3724, longitude: 78.5029 } },
  { name: 'Uppuguda railway station', coord: { latitude: 17.3570, longitude: 78.4888 } },
  { name: 'Sitafalmandi railway station', coord: { latitude: 17.4347, longitude: 78.5017 } },
  { name: 'Jamai Osmania railway station', coord: { latitude: 17.4051, longitude: 78.5001 } },
  { name: 'Vidyanagar railway station', coord: { latitude: 17.4318, longitude: 78.4684 } }
];
export const DEFAULT_MAP_REGION = {
  ...HYDERABAD_CENTER,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};
export const DRIVER_DESTINATION_MARKER_RADIUS_KM = 4.5;
export const DRIVER_DESTINATION_TOGGLE_DAILY_LIMIT = 3;
export const DRIVER_ALERT_SOUND_URL = 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg';
export const CHAT_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
export const VEHICLE_SELECT_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
export const PRIMARY_ACTION_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
export const GAME_BIRD_HIT_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
export const GAME_ZOMBIE_HIT_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
export const GAME_UNLOCK_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg';
export const MARKER_PLACE_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/bell_ding.ogg';
