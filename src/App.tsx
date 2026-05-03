import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Plus, Search, Clock, User, ChevronRight, Settings, 
  MapPin, Star, Calendar, Bell, ChevronLeft, Mail, 
  CheckCircle2, Globe, Moon, Sun, Stethoscope, Wifi, 
  Battery, Users, RefreshCw, LogOut, Info, Heart, Shield, HelpCircle, AlertTriangle, Ambulance, PhoneCall,
  QrCode, BellRing, Activity, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  db, auth, OperationType, handleFirestoreError 
} from './lib/firebase';
import { 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  signInWithPopup,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy,
  serverTimestamp,
  updateDoc,
  addDoc,
  increment
} from 'firebase/firestore';

// Immediate theme load to prevent flash
(function() {
  const saved = localStorage.getItem('docconnect-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

// --- Types ---
type Screen = 'login' | 'home' | 'doctors' | 'book' | 'success' | 'token' | 'doctor-dashboard' | 'profile' | 'settings';
type UserRole = 'patient' | 'doctor';
type DoctorStatus = 'open' | 'busy' | 'break' | 'closed';
interface User {
  uid: string;
  email: string;
  displayName: string;
}
type Language = 'English' | 'हिंदी' | 'ଓଡ଼ିଆ';

interface WorkingDay {
  enabled: boolean;
  start: string; // "09:00"
  end: string;   // "17:00"
}

interface DoctorSchedule {
  monday: WorkingDay;
  tuesday: WorkingDay;
  wednesday: WorkingDay;
  thursday: WorkingDay;
  friday: WorkingDay;
  saturday: WorkingDay;
  sunday: WorkingDay;
}

interface BlockedSlot {
  id: string;
  date: string; // "2024-05-04"
  start: string; // "14:00"
  end: string;
  reason: string;
}

interface Doctor {
  id: string;
  name: string;
  specialty: string;
  emoji: string;
  status: DoctorStatus;
  waitMins: number;
  clinic: string;
  schedule?: DoctorSchedule;
  blockedSlots?: BlockedSlot[];
  // New fields
  availability: boolean;
  queueCount: number;
  maxCapacity: number;
  rating: number;
  location: string;
  experience: number;
  price: number;
}

interface Appointment {
  id: string;
  patientName: string;
  doctor: Doctor;
  bookedAt: Date;
  seenAt?: Date;
  status: 'booked' | 'seen' | 'missed';
  reason: string;
  email: string;
  _lastAlertedPos?: number;
  createdAt?: number;
}

interface ProfileData {
  name: string;
  initials: string;
  email: string;
  phone: string;
  bloodGroup: string;
  age: number;
  weight: number;
  allergies: string;
  role?: UserRole;
  // Doctor specific
  schedule?: DoctorSchedule;
  blockedSlots?: BlockedSlot[];
  specialty?: string;
  clinic?: string;
  emoji?: string;
  regNo?: string;
}

interface SettingsState {
  darkMode: boolean;
  appAlerts: boolean;
  gmailReminders: boolean;
  language: Language;
  defaultCity: string;
}

// --- Utils ---
// --- Constants ---
const DEFAULT_SCHEDULE: DoctorSchedule = {
  monday: { enabled: true, start: "09:00", end: "17:00" },
  tuesday: { enabled: true, start: "09:00", end: "17:00" },
  wednesday: { enabled: true, start: "09:00", end: "17:00" },
  thursday: { enabled: true, start: "09:00", end: "17:00" },
  friday: { enabled: true, start: "09:00", end: "17:00" },
  saturday: { enabled: false, start: "10:00", end: "14:00" },
  sunday: { enabled: false, start: "10:00", end: "14:00" },
};

const SEED_DOCTORS: Doctor[] = [
  {
    id: 'dr_priya',
    name: 'Dr. Priya Sharma',
    specialty: 'General Physician',
    emoji: '👩‍⚕️',
    status: 'open',
    waitMins: 10,
    clinic: 'City Health Clinic',
    availability: true,
    queueCount: 2,
    maxCapacity: 15,
    rating: 4.8,
    location: 'OPD-1, Block A',
    experience: 12,
    price: 500
  },
  {
    id: 'dr_arjun',
    name: 'Dr. Arjun Mehta',
    specialty: 'Cardiologist',
    emoji: '👨‍⚕️',
    status: 'open',
    waitMins: 15,
    clinic: 'Heart Care Center',
    availability: true,
    queueCount: 4,
    maxCapacity: 10,
    rating: 4.9,
    location: 'OPD-3, Block A',
    experience: 15,
    price: 800
  },
  {
    id: 'dr_kavya',
    name: 'Dr. Kavya Nair',
    specialty: 'Pediatrician',
    emoji: '👩‍⚕️',
    status: 'open',
    waitMins: 8,
    clinic: 'Kids Wellness Hub',
    availability: true,
    queueCount: 1,
    maxCapacity: 12,
    rating: 4.7,
    location: 'OPD-5, Block B',
    experience: 8,
    price: 450
  }
];

const getInitials = (name: string) => {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatHHMM = (date: any) => {
  if (!date) return '--:--';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const formatFullDate = (date: any) => {
  if (!date) return 'Not available';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 'Not available';
  // Format: Today, Apr 28 2026 (requested format)
  const isToday = new Date().toDateString() === d.toDateString();
  const dayStr = d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${isToday ? 'Today, ' : ''}${dayStr}`;
};

const generateTimeSlots = (date: Date, doctor?: Doctor) => {
  const slots: { t: string, s: 'available' | 'full' }[] = [];
  
  let startHour = 9;
  let endHour = 17;
  let isWorkingDay = true;

  if (doctor?.schedule) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = days[date.getDay()] as keyof DoctorSchedule;
    const config = doctor.schedule[dayName];
    
    if (config) {
      isWorkingDay = config.enabled;
      if (config.start) startHour = parseInt(config.start.split(':')[0]);
      if (config.end) endHour = parseInt(config.end.split(':')[0]);
    }
  }

  if (!isWorkingDay) return [];

  for (let i = startHour; i < endHour; i++) {
    for (let j = 0; j < 60; j += 30) {
      const d = new Date(date);
      d.setHours(i, j, 0, 0);
      
      const timeStr = formatHHMM(d);
      
      // Check if slot is blocked
      let isBlocked = false;
      if (doctor?.blockedSlots) {
        const dateStr = d.toISOString().split('T')[0];
        const slotTime = d.getHours() * 60 + d.getMinutes();
        
        isBlocked = doctor.blockedSlots.some(block => {
          if (block.date !== dateStr) return false;
          const [hs, ms] = block.start.split(':').map(Number);
          const [he, me] = block.end.split(':').map(Number);
          const blockStart = hs * 60 + ms;
          const blockEnd = he * 60 + me;
          return slotTime >= blockStart && slotTime < blockEnd;
        });
      }

      slots.push({
        t: timeStr,
        s: isBlocked ? 'full' : 'available'
      });
    }
  }
  return slots;
};

const timeFromNow = (mins: number) => new Date(Date.now() + mins * 60000);

// --- Translations ---
const translations: Record<string, Record<string, string>> = {
  en: {
    find_doctor: 'Find a Doctor',
    book_now: 'Book Now →',
    my_token: 'My Queue Token',
    home: 'Home',
    doctors: 'Doctors',
    profile: 'Profile',
    settings: 'Settings',
    appearance: 'Appearance',
    dark_mode: 'Dark Mode',
    dark_mode_sub: 'Switch to dark theme',
    notifications: 'Notifications',
    app_alerts: 'App Alerts',
    app_alerts_sub: 'Notified 10 min before your turn',
    gmail_reminders: 'Gmail Reminders',
    gmail_reminders_sub: 'Email sent before your turn',
    language: 'Language',
    rate_app: 'Rate the App',
    logout: 'Log Out',
    choose_doctor: 'Choose a Doctor',
    book_slot: 'Book Your Slot',
    confirm_booking: 'Confirm Booking →',
    your_turn: 'Your Turn Status',
    now_serving: 'Now Serving',
    people_ahead: 'People Ahead',
    est_wait: 'Est. Wait Time',
    clinic_status: 'Clinic Status',
    notifications_on: 'Notifications ON',
    skip_waiting: 'Skip the waiting room.',
    sign_in: 'Sign In →',
    patient_role: "Patient",
    doctor_role: "Doctor",
    hi_greeting: 'Hi',
    ready: 'Ready to see a doctor?',
    available_now: 'Doctors Available Now',
    my_profile: 'My Profile',
    upcoming: 'Upcoming',
    past: 'Past',
    blood_group: 'Blood Group',
    age: 'Age',
    weight: 'Weight',
    allergies: 'Allergies',
    version: 'Version 1.0.0',
    privacy: 'Privacy Policy',
    new_here: "New here? It's free to join",
    confirm_sub: "We've notified the clinic. Your slot is secured.",
    track: "Track My Turn →",
    visit_reason: "Why are you visiting?",
    emergency_support: 'Emergency Support',
    call_ambulance: 'Call Ambulance',
    ambulance_desc: 'Immediate emergency transport',
    emergency_desc: 'Call 102/108 for medical help',
  },
  hi: {
    find_doctor: 'डॉक्टर खोजें',
    book_now: 'अभी बुक करें →',
    my_token: 'मेरा कतार नंबर',
    home: 'होम',
    doctors: 'डॉक्टर',
    profile: 'प्रोफ़ाइल',
    settings: 'सेटिंग्स',
    appearance: 'दिखावट',
    dark_mode: 'डार्क मोड',
    dark_mode_sub: 'डार्क थीम पर स्विच करें',
    notifications: 'सूचनाएं',
    app_alerts: 'ऐप अलर्ट',
    app_alerts_sub: 'आपकी बारी से 10 मिनट पहले सूचना',
    gmail_reminders: 'Gmail रिमाइंडर',
    gmail_reminders_sub: 'आपकी बारी से पहले ईमेल',
    language: 'भाषा',
    rate_app: 'ऐप को रेट करें',
    logout: 'लॉग आउट',
    choose_doctor: 'डॉक्टर चुनें',
    book_slot: 'स्लॉट बुक करें',
    confirm_booking: 'बुकिंग की पुष्टि करें →',
    your_turn: 'आपकी बारी की स्थिति',
    now_serving: 'अभी सेवा दी जा रही है',
    people_ahead: 'आगे लोग',
    est_wait: 'अनुमानित प्रतीक्षा समय',
    clinic_status: 'क्लिनिक स्थिति',
    notifications_on: 'सूचनाएं चालू हैं',
    skip_waiting: 'प्रतीक्षा कक्ष छोड़ें।',
    sign_in: 'साइन इन करें →',
    patient_role: "मरीज",
    doctor_role: "डॉक्टर",
    hi_greeting: 'नमस्ते',
    ready: 'डॉक्टर से मिलने के लिए तैयार?',
    available_now: 'अभी उपलब्ध डॉक्टर',
    my_profile: 'मेरी प्रोफ़ाइल',
    upcoming: 'आगामी',
    past: 'पिछले',
    blood_group: 'रक्त समूह',
    age: 'आयु',
    weight: 'वजन',
    allergies: 'एलर्जी',
    version: 'संस्करण 1.0.0',
    privacy: 'गोपनीयता नीति',
    new_here: "यहाँ नए हैं? शामिल होना मुफ़्त है",
    confirm_sub: "हमने क्लिनिक को सूचित कर दिया है। आपका स्लॉट सुरक्षित है।",
    track: "मेरी बारी ट्रैक करें →",
    visit_reason: "आप क्यों आ रहे हैं?",
    emergency_support: 'आपातकालीन सहायता',
    call_ambulance: 'एम्बुलेंस बुलाएं',
    ambulance_desc: 'तत्काल आपातकालीन परिवहन',
    emergency_desc: 'चिकित्सा सहायता के लिए 102/108 पर कॉल करें',
  },
  od: {
    find_doctor: 'ଡାକ୍ତର ଖୋଜନ୍ତୁ',
    book_now: 'ବୁକ୍ କରନ୍ତୁ →',
    my_token: 'ମୋ ଧାଡ଼ି ନମ୍ବର',
    home: 'ହୋମ',
    doctors: 'ଡାକ୍ତର',
    profile: 'ପ୍ରୋଫାଇଲ',
    settings: 'ସେଟିଂସ',
    appearance: 'ଦୃଶ୍ୟ',
    dark_mode: 'ଡାର୍କ ମୋଡ',
    dark_mode_sub: 'ଡାର୍କ ଥିମ୍କୁ ସ୍ଵିଚ୍ କରନ୍ତୁ',
    notifications: 'ବିଜ୍ଞପ୍ତି',
    app_alerts: 'ଆପ୍ ଆଲର୍ଟ',
    app_alerts_sub: 'ଆପଣଙ୍କ ପାଳି ୧୦ ମିନିଟ ପୂର୍ବରୁ ସୂଚନା',
    gmail_reminders: 'Gmail ରିମାଇଣ୍ଡର',
    gmail_reminders_sub: 'ଆପଣଙ୍କ ପାଳି ପୂର୍ବରୁ ଇମେଲ',
    language: 'ଭାଷା',
    rate_app: 'ଆପ୍ ରେଟ୍ କରନ୍ତୁ',
    logout: 'ଲଗ୍ ଆଉଟ',
    choose_doctor: 'ଡାକ୍ତର ବାଛନ୍ତୁ',
    book_slot: 'ସ୍ଲଟ୍ ବୁକ୍ କରନ୍ତୁ',
    confirm_booking: 'ବୁକିଂ ନିଶ୍ଚିତ କରନ୍ତୁ →',
    your_turn: 'ଆପଣଙ୍କ ପାଳି ସ୍ଥିତି',
    now_serving: 'ବର୍ତ୍ତମାନ ସେବା',
    people_ahead: 'ଆଗରେ ଲୋକ',
    est_wait: 'ଅନୁମାନିତ ଅପେକ୍ଷା ସମୟ',
    clinic_status: 'କ୍ଲିନିକ ସ୍ଥିତି',
    notifications_on: 'ବିଜ୍ଞପ୍ତି ଚାଲୁ ଅଛି',
    skip_waiting: 'ଅପେକ୍ଷା କକ୍ଷ ଛାଡ଼ନ୍ତୁ।',
    sign_in: 'ସାଇନ ଇନ କରନ୍ତୁ →',
    patient_role: "ରୋଗୀ",
    doctor_role: "ଡାକ୍ତର",
    hi_greeting: 'ନମସ୍କାର',
    ready: 'ଡାକ୍ତରଙ୍କୁ ଭେଟିବାକୁ ପ୍ରସ୍ତୁତ?',
    available_now: 'ବର୍ତ୍ତମାନ ଉପଲବ୍ଧ ଡାକ୍ତର',
    my_profile: 'ମୋ ପ୍ରୋଫାଇଲ',
    upcoming: 'ଆସନ୍ତା',
    past: 'ଗତ',
    blood_group: 'ରକ୍ତ ଗ୍ରୁପ',
    age: 'ବୟସ',
    weight: 'ଓଜନ',
    allergies: 'ଆଲର୍ଜି',
    version: 'ସଂସ୍କରଣ 1.0.0',
    privacy: 'ଗୋପନୀୟତା ନୀତି',
    new_here: "ଏଠାରେ ନୂଆ କି? ଯୋଗଦେବା ମାଗଣା",
    confirm_sub: "ଆମେ କ୍ଲିନିକ୍ କୁ ଜଣାଇଛୁ | ଆପଣଙ୍କର ସ୍ଲଟ୍ ସୁରକ୍ଷିତ ଅଛି |",
    track: "ମୋର ପାଳି ଟ୍ରାକ୍ କରନ୍ତୁ →",
    visit_reason: "ଆପଣ କାହିଁକି ଆସୁଛନ୍ତି?",
    emergency_support: 'ଜରୁରୀକାଳୀନ ସହାୟତା',
    call_ambulance: 'ଆମ୍ବୁଲାନ୍ସକୁ କଲ୍ କରନ୍ତୁ',
    ambulance_desc: 'ତୁରନ୍ତ ଜରୁରୀକାଳୀନ ପରିବହନ',
    emergency_desc: 'ଡାକ୍ତରୀ ସହାୟତା ପାଇଁ ୧୦୨/୧୦୮ କୁ କଲ୍ କରନ୍ତୁ',
  }
};

// --- Components ---
const SplashScreen = () => {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-brand-blue"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="flex flex-col items-center"
      >
        <motion.div 
          animate={{ 
            y: [0, -10, 0],
            rotate: [0, 5, -5, 0]
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="w-24 h-24 bg-white rounded-[40px] flex items-center justify-center shadow-2xl mb-8 border-4 border-white/20"
        >
          <Stethoscope className="w-12 h-12 text-brand-blue" />
        </motion.div>
        
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center"
        >
          <h1 className="text-white text-5xl font-serif font-bold tracking-tighter mb-2">DocConnect</h1>
          <div className="h-1 w-12 bg-white/30 rounded-full mx-auto mb-4" />
          <p className="text-white/60 text-[10px] font-black uppercase tracking-[0.3em]">Smart Healthcare Access</p>
        </motion.div>
      </motion.div>
      
      <div className="absolute bottom-12 flex flex-col items-center gap-4">
        <div className="flex space-x-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ 
                scale: [1, 1.5, 1],
                opacity: [0.3, 1, 0.3] 
              }}
              transition={{ 
                duration: 1, 
                repeat: Infinity, 
                delay: i * 0.2 
              }}
              className="w-1.5 h-1.5 bg-white rounded-full"
            />
          ))}
        </div>
        <p className="text-white/30 text-[9px] font-bold tracking-widest uppercase">Initializing Systems</p>
      </div>
    </motion.div>
  );
};

export default function App() {
  // Navigation & Role
  const [showSplash, setShowSplash] = useState(true);
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');
  const [userRole, setUserRole] = useState<UserRole>('patient');
  const [history, setHistory] = useState<Screen[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  
  // Real-time Clock
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // App State - Profile & Settings
  const [profileData, setProfileData] = useState<ProfileData>({
    name: '',
    initials: '',
    email: '',
    phone: '',
    bloodGroup: 'B+',
    age: 24,
    weight: 58,
    allergies: 'None'
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Set persistence to LOCAL so user stays logged in
    setPersistence(auth, browserLocalPersistence);

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userObj: User = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || 'User'
        };
        setUser(userObj);
        
        // Fetch profile and role
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          setProfileData(data as ProfileData);
          const role = data.role || 'patient';
          setUserRole(role);
          if (data.status) setDocStatus(data.status);
          
          setCurrentScreen(role === 'doctor' ? 'doctor-dashboard' : 'home');
        } else {
          // If first time login, current screen might still be login
          // The handleUserProfile will trigger and create the doc
          // We can't determine the role yet if it's a first time login from Google
          // but we'll default to patient if not found.
        }
      } else {
        setUser(null);
        setCurrentScreen('login');
      }
      setIsAuthLoading(false);
    });

    return () => unsubAuth();
  }, []); // Run only once

  // Real-time profile listener
  useEffect(() => {
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);
    const unsubProfile = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setProfileData(data as ProfileData);
        setUserRole(data.role || 'patient');
        if (data.status) setDocStatus(data.status);
      }
    });
    return () => unsubProfile();
  }, [user]);

  // Listen for Doctors
  useEffect(() => {
    if (!user) {
      setDoctors([]);
      return;
    }
    const q = query(collection(db, 'users'), where('role', '==', 'doctor'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        setDoctors(SEED_DOCTORS);
        return;
      }
      
      const docs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || 'Unknown Doctor',
          specialty: data.specialty || 'General',
          emoji: data.emoji || '👨‍⚕️',
          status: data.status || 'open',
          waitMins: data.waitMins || 10,
          clinic: data.clinic || 'City Health Clinic',
          availability: data.availability ?? true,
          queueCount: data.queueCount ?? Math.floor(Math.random() * 6),
          maxCapacity: data.maxCapacity ?? 10,
          rating: data.rating ?? 4.5,
          location: data.location || 'Consultation Room',
          experience: data.experience ?? 5,
          price: data.price ?? 500
        } as Doctor;
      });
      setDoctors(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => unsubscribe();
  }, [user]);

  const [isAddingBlock, setIsAddingBlock] = useState(false);
  const [newBlock, setNewBlock] = useState<Omit<BlockedSlot, 'id'>>({
    date: new Date().toISOString().split('T')[0],
    start: "10:00",
    end: "11:00",
    reason: "Short Break"
  });

  const updateScheduleDay = (day: keyof DoctorSchedule, field: keyof WorkingDay, val: any) => {
    const currentSchedule = profileData.schedule || DEFAULT_SCHEDULE;
    const newSchedule = {
      ...currentSchedule,
      [day]: { ...currentSchedule[day], [field]: val }
    };
    setProfileData(prev => prev ? { ...prev, schedule: newSchedule } : null);
  };

  const saveSchedule = async () => {
    if (!user || !profileData.schedule) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { schedule: profileData.schedule });
      showToast(CheckCircle2, "Schedule updated successfully ✓");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const addBlockedSlot = async () => {
    if (!user) return;
    const block: BlockedSlot = {
      ...newBlock,
      id: Date.now().toString()
    };
    const currentSlots = profileData.blockedSlots || [];
    const newSlots = [...currentSlots, block];
    
    try {
      await updateDoc(doc(db, 'users', user.uid), { blockedSlots: newSlots });
      setProfileData(prev => prev ? { ...prev, blockedSlots: newSlots } : null);
      setIsAddingBlock(false);
      showToast(CheckCircle2, "Time-off block added ✓");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const removeBlockedSlot = async (id: string) => {
    if (!user) return;
    const currentSlots = profileData.blockedSlots || [];
    const newSlots = currentSlots.filter(s => s.id !== id);
    
    try {
      await updateDoc(doc(db, 'users', user.uid), { blockedSlots: newSlots });
      setProfileData(prev => prev ? { ...prev, blockedSlots: newSlots } : null);
      showToast(CheckCircle2, "Block removed ✓");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const [settings, setSettings] = useState<SettingsState>(() => {
    const saved = localStorage.getItem('settings');
    const savedLang = (localStorage.getItem('docconnect-lang') as Language) || 'English';
    return saved ? { ...JSON.parse(saved), language: savedLang } : {
      darkMode: false,
      appAlerts: true,
      gmailReminders: true,
      language: 'English',
      defaultCity: 'Bhubaneswar'
    };
  });

  // UI & Experience State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('docconnect-theme') as 'light' | 'dark') || 'light';
  });
  const [toasts, setToasts] = useState<{ id: number; icon: any; msg: string; timestamp: string }[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [isLoadingDoctors, setIsLoadingDoctors] = useState(false);
  const [editingField, setEditingField] = useState<keyof ProfileData | null>(null);
  const [appointmentTab, setAppointmentTab] = useState<'upcoming' | 'past'>('upcoming');
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);

  const [docDashboardView, setDocDashboardView] = useState<'queue' | 'schedule'>('queue');

  // Business Logic State
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [seedStatus, setSeedStatus] = useState<'idle' | 'seeding' | 'done'>('idle');

  // Seeding effect
  useEffect(() => {
    if (user && seedStatus === 'idle' && doctors.length === 0 && !isAuthLoading) {
      const seedData = async () => {
        setSeedStatus('seeding');
        try {
          for (const docData of SEED_DOCTORS) {
            const docRef = doc(db, 'users', docData.id);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) {
              await setDoc(docRef, {
                ...docData,
                role: 'doctor',
                initials: getInitials(docData.name),
                email: `${docData.id}@docconnect.com`,
                updatedAt: serverTimestamp()
              });
            }
          }
          setSeedStatus('done');
        } catch (e) {
          console.error("Seed error", e);
          setSeedStatus('idle');
        }
      };
      seedData();
    }
  }, [user, doctors.length, seedStatus, isAuthLoading]);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [bookingDate, setBookingDate] = useState<Date>(new Date());
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<Appointment | null>(() => {
    const saved = localStorage.getItem('bookingStatus');
    try {
      if (saved && saved !== 'null') {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          if (parsed.bookedAt) parsed.bookedAt = new Date(parsed.bookedAt);
          if (parsed.seenAt) parsed.seenAt = new Date(parsed.seenAt);
          return parsed;
        }
      }
    } catch (e) {
      console.error("Error parsing bookingStatus", e);
    }
    return null;
  });

  const [doctorQueue, setDoctorQueue] = useState<Appointment[]>(() => {
    const saved = localStorage.getItem('doctorQueue');
    try {
      if (saved && saved !== 'null') {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((a: any) => a && typeof a === 'object')
            .map((a: any) => ({
              ...a,
              bookedAt: a.bookedAt ? new Date(a.bookedAt) : new Date(),
              seenAt: a.seenAt ? new Date(a.seenAt) : undefined
            }));
        }
      }
    } catch (e) {
      console.error("Error parsing doctorQueue", e);
    }
    return [];
  });

  const [docStatus, setDocStatus] = useState<DoctorStatus>(() => {
    return (localStorage.getItem('docStatus') as DoctorStatus) || 'open';
  });

  useEffect(() => {
    localStorage.setItem('bookingStatus', JSON.stringify(bookingStatus));
  }, [bookingStatus]);

  useEffect(() => {
    localStorage.setItem('doctorQueue', JSON.stringify(doctorQueue));
  }, [doctorQueue]);

  const setDocStatusInFirebase = async (s: DoctorStatus) => {
    if (!user) return;
    setDocStatus(s);
    try {
      await updateDoc(doc(db, 'users', user.uid), { status: s });
      showToast(CheckCircle2, `Clinic status: ${s.toUpperCase()}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const langCode = useMemo(() => {
    if (settings.language === 'हिंदी') return 'hi';
    if (settings.language === 'ଓଡ଼ିଆ') return 'od';
    return 'en';
  }, [settings.language]);

  const t = (key: string) => translations[langCode][key] || key;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('docconnect-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('settings', JSON.stringify(settings));
    localStorage.setItem('docconnect-lang', settings.language);
  }, [settings]);

  // Sync patient bookingStatus with doctorQueue
  const [activeQueue, setActiveQueue] = useState<Appointment[]>([]);

  // Listen for Appointments
  useEffect(() => {
    if (!user) {
      setDoctorQueue([]);
      return;
    }

    let q;
    if (userRole === 'doctor') {
      q = query(collection(db, 'appointments'), where('doctor.id', '==', user.uid), orderBy('bookedAt', 'desc'));
    } else {
      q = query(collection(db, 'appointments'), where('patientUid', '==', user.uid), orderBy('bookedAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const apts = snapshot.docs.map(doc => {
        const data = doc.data();
        const id = doc.id;
        // Ensure bookedAt is NEVER null
        const bookedAt = data.bookedAt && typeof data.bookedAt.toDate === 'function' ? data.bookedAt.toDate() : new Date();
        const seenAt = data.seenAt && typeof data.seenAt.toDate === 'function' ? data.seenAt.toDate() : undefined;
        return {
          ...data,
          id,
          bookedAt,
          seenAt
        } as Appointment;
      });
      setDoctorQueue(apts);
      
      if (userRole === 'patient') {
        const booked = apts.filter(a => a.status === 'booked');
        booked.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setBookingStatus(booked[0] || null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'appointments');
    });

    return () => unsubscribe();
  }, [user, userRole]);

  // Track full queue for patient's doctor
  useEffect(() => {
    if (userRole !== 'patient' || !bookingStatus?.doctor?.id || bookingStatus.status !== 'booked') {
      setActiveQueue([]);
      return;
    }

    const q = query(
      collection(db, 'appointments'), 
      where('doctor.id', '==', bookingStatus.doctor.id),
      where('status', '==', 'booked'),
      orderBy('bookedAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const queue = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          bookedAt: data.bookedAt && typeof data.bookedAt.toDate === 'function' ? data.bookedAt.toDate() : new Date()
        } as Appointment;
      });
      setActiveQueue(queue);
    }, (error) => {
      // Don't toast for index errors here, just log
      console.warn("Queue listener error:", error);
    });

    return () => unsubscribe();
  }, [userRole, bookingStatus?.doctor?.id, bookingStatus?.status]);

  // Sync patient bookingStatus with activeQueue for accurate queue position
  useEffect(() => {
    if (userRole === 'patient' && bookingStatus && activeQueue.length > 0) {
      const updated = activeQueue.find(a => a.id === bookingStatus.id);
      
      // Update status if it changed
      if (updated && (updated.status !== bookingStatus.status || updated.seenAt !== bookingStatus.seenAt)) {
        setBookingStatus(updated);
        
        if (updated.status === 'seen') {
           showToast(CheckCircle2, t('confirm_sub'));
        }
      }

      // Check position for alerts based on activeQueue, not doctorQueue
      const currentPos = activeQueue.findIndex(a => a.id === bookingStatus.id) + 1;
      
      // We need to keep track of the last alerted position to avoid spamming
      if (updated?.status === 'booked' && currentPos !== bookingStatus._lastAlertedPos) {
        if (currentPos === 1) {
           showToast(Bell, "Your entry code is called! Please proceed to the cabin.");
           setBookingStatus(prev => prev ? { ...prev, _lastAlertedPos: 1 } : null);
        } else if (currentPos === 2) {
           showToast(Bell, "Your turn is coming soon! You are next in line.");
           setBookingStatus(prev => prev ? { ...prev, _lastAlertedPos: 2 } : null);
        }
      }
    }
  }, [activeQueue, bookingStatus, userRole, t]);

  // Initialization & Clock Interval
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Periodic Recalculations (Queue/Estimates)
  useEffect(() => {
    const minuteTimer = setInterval(() => {
      // Force re-renders for time-sensitive estimations
      console.log('Refreshing estimations...');
    }, 30000); // Every 30s as requested for some screens
    return () => clearInterval(minuteTimer);
  }, [currentScreen]);

  // --- Handlers ---
  const showToast = (icon: any, msg: string) => {
    const id = Date.now();
    const timestamp = formatHHMM(new Date());
    setToasts(prev => [...prev, { id, icon, msg, timestamp }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const goTo = (screen: Screen) => {
    setHistory(prev => [...prev, currentScreen]);
    setCurrentScreen(screen);
  };

  const goBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(prevHistory => prevHistory.slice(0, -1));
      setCurrentScreen(prev);
    } else {
      goTo('home');
    }
  };

  const toggleSetting = (key: keyof SettingsState) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const saveProfileField = async (field: keyof ProfileData, val: any) => {
    if (!user) return;
    
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const updates: any = { [field]: val };
      if (field === 'name') {
        updates.initials = getInitials(val);
      }
      await updateDoc(userDocRef, updates);
      setEditingField(null);
      showToast(CheckCircle2, "✓ Saved!");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const triggerRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      showToast(CheckCircle2, "Updated just now ✓");
    }, 1500);
  };

  const filteredDoctors = useMemo(() => {
    let result = doctors;

    // Apply category filter
    if (selectedCategory !== 'All') {
      result = result.filter(doc => {
        if (selectedCategory === 'Physician') return doc.specialty.toLowerCase().includes('physician');
        if (selectedCategory === 'Kids') return doc.specialty.toLowerCase().includes('pediatrician') || doc.specialty.toLowerCase().includes('child');
        if (selectedCategory === 'Dermato') return doc.specialty.toLowerCase().includes('dermato');
        if (selectedCategory === 'Gastro') return doc.specialty.toLowerCase().includes('gastro');
        return true;
      });
    }

    // Apply search query
    if (searchQuery) {
      result = result.filter(doc => 
        doc.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        doc.specialty.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply availability filter
    if (availableOnly) {
      result = result.filter(doc => doc.availability);
    }

    // Fallback: If result is empty but we have doctors, show all available doctors instead
    if (result.length === 0 && doctors.length > 0) {
      return doctors;
    }

    return result.length > 0 ? result : doctors;
  }, [searchQuery, selectedCategory, availableOnly, doctors]);

  const loadDoctorsWithSkeleton = () => {
    setIsLoadingDoctors(true);
    setTimeout(() => setIsLoadingDoctors(false), 800);
  };

  useEffect(() => {
    if (currentScreen === 'doctors') loadDoctorsWithSkeleton();
  }, [currentScreen]);

  const handleUserProfile = async (mockUser: User, role: UserRole, displayName?: string) => {
    const userDocRef = doc(db, 'users', mockUser.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      const newProfile: any = {
        uid: mockUser.uid,
        name: displayName || mockUser.displayName || 'User',
        email: mockUser.email || '',
        role: role,
        initials: getInitials(displayName || mockUser.displayName || 'U'),
        bloodGroup: 'B+',
        age: 24,
        weight: 58,
        allergies: 'None',
        createdAt: serverTimestamp(),
        // Doctor specific defaults
        ...(role === 'doctor' && {
          specialty: 'Surgeon',
          emoji: '👨‍⚕️',
          clinic: 'City Health Clinic',
          status: 'open',
          waitMins: 15,
          schedule: DEFAULT_SCHEDULE,
          blockedSlots: [],
          regNo: `RN-${Math.floor(100000 + Math.random() * 900000)}`
        })
      };
      await setDoc(userDocRef, newProfile);
      setProfileData(newProfile as ProfileData);
      setUserRole(role);
    } else {
      const data = userDoc.data();
      setUserRole(data.role || 'patient');
      
      // If doctor but missing doctor-specific fields, patch them
      if (data.role === 'doctor' && !data.specialty) {
        await updateDoc(userDocRef, {
          specialty: 'General Physician',
          emoji: '👨‍⚕️',
          clinic: 'City Health Clinic',
          status: data.status || 'open',
          waitMins: data.waitMins || 12
        });
      }
    }
  };

  const doLogin = async (role: UserRole) => {
    setIsAuthSubmitting(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        const userObj: User = {
          uid: result.user.uid,
          email: result.user.email || '',
          displayName: result.user.displayName || 'User'
        };
        setUser(userObj);
        await handleUserProfile(userObj, role);
        setCurrentScreen(role === 'doctor' ? 'doctor-dashboard' : 'home');
        showToast(CheckCircle2, `Logged in as ${role}`);
      }
    } catch (error) {
      console.error("Google login error Details:", error);
      showToast(AlertTriangle, `Google login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const doEmailAuth = async (role: UserRole) => {
    if (!authEmail || !authPassword) {
      showToast(AlertTriangle, "Please enter email and password");
      return;
    }
    if (isSignUp && !authName) {
      showToast(AlertTriangle, "Please enter your name");
      return;
    }

    setIsAuthSubmitting(true);
    try {
      if (isSignUp) {
        const result = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        const userObj: User = {
          uid: result.user.uid,
          email: result.user.email || '',
          displayName: authName
        };
        setUser(userObj);
        await handleUserProfile(userObj, role, authName);
        setCurrentScreen(role === 'doctor' ? 'doctor-dashboard' : 'home');
        showToast(CheckCircle2, "Account created successfully!");
      } else {
        const result = await signInWithEmailAndPassword(auth, authEmail, authPassword);
        const userObj: User = {
          uid: result.user.uid,
          email: result.user.email || '',
          displayName: result.user.displayName || authEmail.split('@')[0]
        };
        setUser(userObj);
        // handleUserProfile will sync the role
        const userDocRef = doc(db, 'users', result.user.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          const targetRole = data.role || role;
          setCurrentScreen(targetRole === 'doctor' ? 'doctor-dashboard' : 'home');
        } else {
          await handleUserProfile(userObj, role);
          setCurrentScreen(role === 'doctor' ? 'doctor-dashboard' : 'home');
        }
        showToast(CheckCircle2, "Logged in!");
      }
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        try {
          // Attempt to seamlessly sign in instead
          const result = await signInWithEmailAndPassword(auth, authEmail, authPassword);
          const userObj: User = {
            uid: result.user.uid,
            email: result.user.email || '',
            displayName: result.user.displayName || authEmail.split('@')[0]
          };
          setUser(userObj);
          const userDocRef = doc(db, 'users', result.user.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const data = userDoc.data();
            const targetRole = data.role || role;
            setCurrentScreen(targetRole === 'doctor' ? 'doctor-dashboard' : 'home');
          } else {
            await handleUserProfile(userObj, role);
            setCurrentScreen(role === 'doctor' ? 'doctor-dashboard' : 'home');
          }
          showToast(CheckCircle2, "Logged in!");
          return;
        } catch (signInError: any) {
          setIsSignUp(false);
          showToast(AlertTriangle, "Email already registered. Please sign in with correct password.");
        }
      } else if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        showToast(AlertTriangle, "Invalid email or password");
      } else {
        console.error("Auth error:", error.code, error.message);
        showToast(AlertTriangle, error.message || "Authentication failed");
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const doLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setCurrentScreen('login');
      setBookingStatus(null);
      showToast(LogOut, "Logged out successfully");
    } catch (error) {
      showToast(AlertTriangle, "Logout failed");
    }
  };

  const availableTimeSlots = useMemo(() => generateTimeSlots(bookingDate, selectedDoctor || undefined), [bookingDate?.toDateString(), selectedDoctor]);

  const confirmBooking = async () => {
    if (!selectedDoctor || !selectedTimeSlot || !user) return;
    
    // Parse selectedTimeSlot to Date
    const appointmentDate = new Date(bookingDate);
    const timeParts = selectedTimeSlot.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (timeParts) {
      let hours = parseInt(timeParts[1]);
      const mins = parseInt(timeParts[2]);
      if (timeParts[3].toUpperCase() === 'PM' && hours < 12) hours += 12;
      if (timeParts[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
      appointmentDate.setHours(hours, mins, 0, 0);
    } else {
      // Fallback to now if somehow parsing fails, though UI prevents this
      appointmentDate.setTime(Date.now());
    }

    const appointmentId = `T-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    const appointmentData = {
      id: appointmentId,
      patientUid: user.uid,
      patientName: profileData.name || 'Anonymous Patient',
      doctor: {
        id: selectedDoctor.id,
        name: selectedDoctor.name,
        specialty: selectedDoctor.specialty,
        emoji: selectedDoctor.emoji,
        clinic: selectedDoctor.clinic
      },
      bookedAt: appointmentDate, // Ensure bookedAt is a valid Date
      createdAt: Date.now(),
      status: 'booked',
      reason: 'General Consultation',
      email: profileData.email || user.email
    };

    try {
      await setDoc(doc(db, 'appointments', appointmentId), appointmentData);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `appointments/${appointmentId}`);
      return;
    }

    try {
      // Increment doctor's queueCount only if it's not a seed doctor
      if (!SEED_DOCTORS.find(d => d.id === selectedDoctor.id)) {
        await updateDoc(doc(db, 'users', selectedDoctor.id), {
          queueCount: increment(1)
        });
      }
      goTo('success');
      startNotificationTimeline(appointmentData as any);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${selectedDoctor.id}`);
    }
  };

  const startNotificationTimeline = (apt: Appointment) => {
    setTimeout(() => showToast(Mail, `Confirmation sent to ${apt.email}`), 2000);
    setTimeout(() => showToast(Bell, `Reminder scheduled for ${formatHHMM(timeFromNow(15))}`), 5000);
  };

  const markDone = async (id: string) => {
    const apt = doctorQueue.find(p => p.id === id);
    try {
      await updateDoc(doc(db, 'appointments', id), {
        status: 'seen',
        seenAt: serverTimestamp()
      });
      
      // Decrement doctor's queueCount if the doctor is the current user
      if (user && profileData.role === 'doctor') {
        await updateDoc(doc(db, 'users', user.uid), {
          queueCount: increment(-1)
        });
      }
      showToast(CheckCircle2, "Patient marked as Done");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `appointments/${id}`);
    }
  };

  const callNext = (id: string) => {
    const patient = doctorQueue.find(p => p.id === id);
    if (!patient) return;
    showToast(Mail, `Gmail alert sent to ${patient.patientName}`);
  };

  const queueStats = useMemo(() => {
    const waiting = doctorQueue.filter(p => p.status === 'booked').length;
    const seen = doctorQueue.filter(p => p.status === 'seen').length;
    return { total: doctorQueue.length, waiting, seen };
  }, [doctorQueue]);

  const getDoctorWaitMins = useCallback((docId?: string) => {
    if (!docId) return 10;
    if (userRole === 'doctor' && profileData.uid === docId) return profileData.waitMins || 10;
    const doc = doctors.find(d => d.id === docId);
    return doc?.waitMins || 10;
  }, [doctors, profileData, userRole]);

  const getWaitMinsText = useCallback((posIndex: number, waitMins: number, bookedAt?: Date) => {
    if (posIndex < 0) return 'Calculating...';
    
    // Default to a 0 delay if not passed
    const baseTime = bookedAt ? Math.max(currentTime.getTime(), bookedAt.getTime()) : currentTime.getTime();
    let totalMins = Math.floor((baseTime + posIndex * waitMins * 60000 - currentTime.getTime()) / 60000);
    
    // If we only have wait time relative to posIndex (no bookedAt, i.e. pure queue logic)
    if (!bookedAt && posIndex === 0) return 'Your turn now';
    if (!bookedAt) totalMins = posIndex * waitMins;

    if (totalMins <= 0) return 'Your turn now';
    if (totalMins >= 60) {
      const hrs = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      return `${hrs} hr ${mins} min`;
    }
    return `${totalMins} min`;
  }, [currentTime]);

  const getEstCheckinTime = useCallback((posIndex: number, waitMins: number, bookedAt?: Date) => {
    if (posIndex < 0) return null;
    const baseTime = bookedAt ? Math.max(currentTime.getTime(), bookedAt.getTime()) : currentTime.getTime();
    return new Date(baseTime + posIndex * waitMins * 60000);
  }, [currentTime]);

  // --- UI Components ---

  const TopNav = () => {
    const hideOn = ['login', 'success', 'doctor-dashboard'];
    if (hideOn.includes(currentScreen)) return null;

    return (
      <header className="h-16 bg-nav-bg border-b border-border-main flex items-center justify-between px-6 sticky top-0 z-50 transition-colors shadow-sm">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => goTo('home')}>
          <div className="bg-brand-blue p-1.5 rounded-lg text-white">
            <Stethoscope size={18} />
          </div>
          <span className="font-serif font-bold text-lg text-brand-blue tracking-tight">DOC-CONNECT</span>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="p-2.5 rounded-xl bg-input-bg text-text-muted hover:text-brand-blue transition-colors"
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <div 
            onClick={() => goTo('profile')}
            className="w-10 h-10 bg-brand-blue text-white rounded-full flex items-center justify-center font-serif text-sm cursor-pointer hover:ring-4 ring-brand-blue/10 transition-all shadow-blue overflow-hidden"
          >
            {profileData.initials || '?'}
          </div>
        </div>
      </header>
    );
  };

  const BottomNav = () => {
    if (userRole !== 'patient' || ['login', 'success'].includes(currentScreen)) return null;

    const navs = [
      { id: 'home', icon: Plus, label: t('home') },
      { id: 'doctors', icon: Search, label: t('doctors') },
      { id: 'token', icon: Clock, label: t('my_token') },
      { id: 'profile', icon: User, label: t('profile') },
    ];

    return (
      <div className="fixed bottom-0 left-0 right-0 z-[100] px-6 pb-8 pt-4 bg-gradient-to-t from-bg-main via-bg-main to-transparent pointer-events-none">
        <nav className="max-w-md mx-auto bg-card-bg border border-border-main p-2 rounded-[32px] shadow-2xl flex justify-between items-center pointer-events-auto ring-1 ring-border-main/20">
          {navs.map(nav => (
            <button 
              key={nav.id} 
              onClick={() => goTo(nav.id as any)}
              className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-4 rounded-2xl transition-all ${
                currentScreen === nav.id ? 'bg-brand-blue text-white shadow-blue' : 'text-text-muted hover:text-text-main'
              }`}
            >
              <nav.icon size={20} strokeWidth={currentScreen === nav.id ? 3 : 2} />
              <span className="text-[8px] font-black uppercase tracking-widest leading-none">{nav.label.split(' ')[0]}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  };

  const ToastContainer = () => (
    <div className="fixed top-20 right-6 z-[100] w-full max-w-sm pointer-events-none space-y-2">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div 
            key={toast.id}
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-card-bg/95 backdrop-blur-sm border border-border-main shadow-2xl py-3 px-4 rounded-2xl flex items-center gap-3 pointer-events-auto"
          >
            <div className="bg-brand-light p-2 rounded-lg">
              <toast.icon className="text-brand-blue" size={16} />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-main">{toast.msg}</p>
              <p className="text-[10px] text-text-muted font-bold tracking-tight">Sent at {toast.timestamp}</p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );

  const RatingModal = () => {
    const msgs = ['', 'Thanks for your feedback.', 'We will improve!', 'Good to know!', 'Great, thank you! 😊', 'Amazing! You made our day! ⭐'];
    
    return (
      <AnimatePresence>
        {isRatingModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsRatingModalOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-card-bg rounded-[32px] p-8 shadow-2xl overflow-hidden"
            >
              <h4 className="text-2xl font-bold text-text-main text-center mb-2" data-i18n="rate_app">{t('rate_app')}</h4>
              <p className="text-xs text-text-muted text-center mb-8">How was your experience?</p>
              
              <div className="flex justify-center gap-2 mb-10">
                {[1, 2, 3, 4, 5].map(star => (
                  <button 
                    key={star} 
                    onClick={() => setRatingStars(star)}
                    className={`p-1 transition-all ${ratingStars >= star ? 'text-yellow-400' : 'text-border-main'}`}
                  >
                    <motion.div 
                      whileTap={{ scale: 1.2 }}
                      initial={false}
                    >
                      <Star size={36} weight={ratingStars >= star ? 'fill' : 'bold'} />
                    </motion.div>
                  </button>
                ))}
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setIsRatingModalOpen(false)}
                  className="flex-1 bg-input-bg text-text-muted font-bold py-4 rounded-2xl active:scale-95 transition-transform"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    if (ratingStars === 0) {
                      showToast(Star, "Please select stars first");
                      return;
                    }
                    setIsRatingModalOpen(false);
                    showToast(Star, msgs[ratingStars]);
                    setRatingStars(0);
                  }}
                  className="flex-[2] bg-brand-blue text-white font-bold py-4 rounded-2xl shadow-blue active:scale-95 transition-transform"
                >
                  Submit ⭐
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    );
  };

  return (
    <div className="min-h-screen bg-bg-main flex flex-col">
      <AnimatePresence>
        {showSplash && <SplashScreen key="splash" />}
      </AnimatePresence>

      {isAuthLoading && !showSplash && (
        <div className="min-h-screen bg-brand-blue flex items-center justify-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-6"
          >
            <div className="bg-white p-6 rounded-[40px] shadow-2xl animate-bounce">
              <Stethoscope size={48} className="text-brand-blue" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-white text-2xl font-serif font-bold tracking-widest">DOC-CONNECT</h1>
              <div className="w-24 h-1 bg-white/20 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                  className="w-full h-full bg-white transition-all shadow-[0_0_15px_rgba(255,255,255,0.5)]"
                />
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {!isAuthLoading && !showSplash && (
        <>
          <TopNav />
          <BottomNav />
          <ToastContainer />
          <RatingModal />

          <main className={`flex-1 flex flex-col ${userRole === 'patient' && !['login', 'success'].includes(currentScreen) ? 'pb-32' : ''}`}>
        <AnimatePresence mode="popLayout">
            {/* Screen: LOGIN */}
            {currentScreen === 'login' && (
              <motion.div 
                key="login"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 bg-gradient-to-br from-brand-blue to-brand-dark p-6 flex items-center justify-center text-white overflow-y-auto"
              >
                <div className="w-full max-w-md space-y-8 bg-white/5 backdrop-blur-xl p-8 rounded-[40px] border border-white/10 shadow-2xl my-8">
                  <div className="flex flex-col items-center text-center">
                    <div className="bg-white text-brand-blue p-5 rounded-3xl mb-6 shadow-xl">
                      <Stethoscope size={40} />
                    </div>
                    <h1 className="text-4xl font-serif mb-2 tracking-tight">DOC-CONNECT</h1>
                    <p className="text-white/70 font-medium mb-8">Smart Healthcare · Simple Booking</p>
                    
                    <div className="w-full space-y-1 mb-8">
                      <div className="text-[10px] font-black opacity-40 uppercase tracking-[0.2em]">
                        {formatFullDate(currentTime)}
                      </div>
                      <div className="text-3xl font-black tabular-nums tracking-tighter">
                        {formatHHMM(currentTime)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex bg-white/10 p-1.5 rounded-2xl gap-2">
                      <button 
                        onClick={() => setUserRole('patient')}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all role-btn ${userRole === 'patient' ? 'bg-white text-brand-blue shadow-lg' : 'text-white'}`}
                      >
                        👤 {t('patient_role')}
                      </button>
                      <button 
                        onClick={() => setUserRole('doctor')}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all role-btn ${userRole === 'doctor' ? 'bg-white text-brand-blue shadow-lg' : 'text-white'}`}
                      >
                        🩺 {t('doctor_role')}
                      </button>
                    </div>

                    <div className="space-y-3">
                      {isSignUp && (
                        <div className="relative group">
                          <User className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-white transition-colors" size={18} />
                          <input 
                            type="text" 
                            placeholder="Full Name" 
                            value={authName}
                            onChange={(e) => setAuthName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && doEmailAuth(userRole)}
                            className="w-full bg-white/10 border border-white/20 rounded-xl py-4 pl-12 pr-5 placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-all font-bold text-sm text-white" 
                          />
                        </div>
                      )}
                      <div className="relative group">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-white transition-colors" size={18} />
                        <input 
                          type="email" 
                          placeholder="Email" 
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && doEmailAuth(userRole)}
                          className="w-full bg-white/10 border border-white/20 rounded-xl py-4 pl-12 pr-5 placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-all font-bold text-sm text-white" 
                        />
                      </div>
                      <div className="relative group">
                        <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-white transition-colors" size={18} />
                        <input 
                          type="password" 
                          placeholder="Password" 
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && doEmailAuth(userRole)}
                          className="w-full bg-white/10 border border-white/20 rounded-xl py-4 pl-12 pr-5 placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-all font-bold text-sm text-white" 
                        />
                      </div>
                    </div>

                    <button 
                      onClick={() => doEmailAuth(userRole)}
                      disabled={isAuthSubmitting}
                      className="w-full bg-white text-brand-blue font-black py-5 rounded-2xl shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAuthSubmitting ? (
                        <RefreshCw size={20} className="animate-spin" />
                      ) : (
                        <span className="uppercase tracking-widest text-sm">{isSignUp ? 'Create Account' : 'Sign In'}</span>
                      )}
                    </button>

                    <div className="flex items-center gap-4 py-2">
                      <div className="flex-1 h-[1px] bg-white/20"></div>
                      <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">OR</span>
                      <div className="flex-1 h-[1px] bg-white/20"></div>
                    </div>

                    <button 
                      onClick={() => doLogin(userRole)}
                      disabled={isAuthSubmitting}
                      className="w-full bg-white/10 border border-white/20 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-all hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {isAuthSubmitting ? (
                        <RefreshCw size={18} className="animate-spin" />
                      ) : (
                        <>
                          <Globe size={18} />
                          <span className="uppercase tracking-widest text-xs">Continue with Google</span>
                        </>
                      )}
                    </button>

                    <button 
                      onClick={() => setIsSignUp(!isSignUp)}
                      className="w-full text-center text-sm font-medium text-white/80 hover:text-white transition-colors py-2"
                    >
                      {isSignUp ? "Already have an account? Sign In" : "New here? Create an account"}
                    </button>
                  </div>
                </div>
            </motion.div>
          )}

            {/* Screen: PROFILE */}
            {currentScreen === 'profile' && (
              <motion.div 
                key="profile"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="p-6 h-full flex flex-col items-center overflow-y-auto no-scrollbar"
              >
                <div className="w-full max-w-4xl py-6 md:py-10">
                  <div className="flex items-center gap-4 mb-12">
                    <button onClick={goBack} className="bg-card-bg p-3 rounded-2xl border border-border-main shadow-sm hover:scale-105 active:scale-95 transition-all">
                      <ChevronLeft size={20} className="text-text-muted" />
                    </button>
                    <h2 className="font-black text-2xl text-text-main" data-i18n="my_profile">{t('my_profile')}</h2>
                  </div>

                  <div className="grid md:grid-cols-3 gap-10">
                    <div className="md:col-span-1 flex flex-col items-center text-center">
                      <div className="w-32 h-32 bg-brand-blue rounded-[40px] flex items-center justify-center text-white text-5xl font-serif mb-6 shadow-blue user-initials-display">
                        {profileData.initials || '?'}
                      </div>
                      
                      {editingField === 'name' ? (
                        <div className="w-full">
                          <input 
                            autoFocus
                            className="text-2xl font-serif text-brand-blue text-center bg-transparent border-b-2 border-brand-blue focus:outline-none w-full"
                            defaultValue={profileData.name}
                            onBlur={(e) => saveProfileField('name', e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveProfileField('name', e.currentTarget.value)}
                          />
                        </div>
                      ) : (
                        <h3 onClick={() => setEditingField('name')} className="text-2xl font-serif text-text-main cursor-pointer hover:text-brand-blue transition-colors user-name-display">{profileData.name || 'Set Name'}</h3>
                      )}
                      
                      <div className="mt-2 space-y-2">
                        {['email', 'phone'].map(f => (
                          <div key={f}>
                            {editingField === f ? (
                              <input 
                                autoFocus
                                className="text-sm text-brand-blue bg-transparent border-b border-brand-blue focus:outline-none text-center w-full"
                                defaultValue={(profileData as any)[f]}
                                onBlur={(e) => saveProfileField(f as any, e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && saveProfileField(f as any, e.currentTarget.value)}
                              />
                            ) : (
                              <p onClick={() => setEditingField(f)} className={`text-sm text-text-muted font-bold hover:text-brand-blue transition-colors cursor-pointer ${f === 'email' ? 'user-email-display' : ''}`}>
                                {(profileData as any)[f] || `Set ${f}`}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="md:col-span-2 space-y-8">
                      <div className="bg-card-bg border border-border-main rounded-[32px] overflow-hidden shadow-sm">
                        <button 
                          onClick={() => setEditingField(editingField === 'health' ? null : 'health')}
                          className="w-full p-6 flex justify-between items-center bg-brand-light/20"
                        >
                          <h4 className="font-black text-text-main flex items-center gap-3">
                            <Stethoscope size={20} className="text-brand-blue" />
                            Health Dashboard
                          </h4>
                          <Plus size={20} className={`text-brand-blue transition-transform duration-500 ${editingField === 'health' ? 'rotate-45' : ''}`} />
                        </button>
                        
                        <AnimatePresence>
                          {editingField === 'health' && (
                            <motion.div 
                              initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                              className="overflow-hidden bg-card-bg"
                            >
                              <div className="p-8 grid grid-cols-2 md:grid-cols-4 gap-6 border-t border-border-main">
                                {[
                                  { l: t('blood_group'), k: 'bloodGroup', i: '🩸' },
                                  { l: t('age'), k: 'age', i: '🎂' },
                                  { l: t('weight'), k: 'weight', i: '⚖️' },
                                  { l: t('allergies'), k: 'allergies', i: '⚠️' },
                                ].map(item => (
                                  <div key={item.k} className="bg-input-bg p-4 rounded-2xl flex flex-col">
                                    <p className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-2">{item.i} {item.l}</p>
                                    <input 
                                      className="w-full bg-transparent border-none p-0 text-sm font-black text-text-main focus:outline-none"
                                      defaultValue={(profileData as any)[item.k]}
                                      onBlur={(e) => saveProfileField(item.k as any, e.target.value)}
                                    />
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      <div className="bg-card-bg border border-border-main rounded-[32px] p-6 shadow-sm">
                        <div className="flex gap-8 border-b border-border-main pb-4 mb-6">
                          <button onClick={() => setAppointmentTab('upcoming')} className={`text-xs font-black uppercase tracking-[0.2em] transition-all relative ${appointmentTab === 'upcoming' ? 'text-brand-blue' : 'text-text-muted'}`}>
                            {t('upcoming')}
                            {appointmentTab === 'upcoming' && <motion.div layoutId="tab-underline" className="absolute -bottom-[18px] left-0 right-0 h-1 bg-brand-blue rounded-t-full" />}
                          </button>
                          <button onClick={() => setAppointmentTab('past')} className={`text-xs font-black uppercase tracking-[0.2em] transition-all relative ${appointmentTab === 'past' ? 'text-brand-blue' : 'text-text-muted'}`}>
                            {t('past')}
                            {appointmentTab === 'past' && <motion.div layoutId="tab-underline" className="absolute -bottom-[18px] left-0 right-0 h-1 bg-brand-blue rounded-t-full" />}
                          </button>
                        </div>
                        
                        {appointmentTab === 'upcoming' ? (
                          (bookingStatus && bookingStatus.status === 'booked') ? (
                            <div className="bg-brand-blue/5 p-6 rounded-[24px] border border-brand-blue/10 flex items-center justify-between">
                              <div>
                                 <p className="font-black text-text-main text-base mb-1">{bookingStatus?.doctor?.name}</p>
                                 <p className="text-[10px] text-text-muted font-bold tracking-wider uppercase">Token {bookingStatus?.id} • {formatFullDate(bookingStatus?.bookedAt || new Date())}</p>
                              </div>
                              <button onClick={() => goTo('token')} className="bg-brand-blue text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-blue active:scale-95 transition-transform">
                                Track Now
                              </button>
                            </div>
                          ) : (
                            <div className="py-12 text-center">
                              <Calendar size={48} className="mx-auto text-border-main/50 mb-4" strokeWidth={1.5} />
                              <p className="text-sm font-bold text-text-muted mb-6">No appointments booked yet.</p>
                              <button onClick={() => goTo('doctors')} className="bg-brand-blue text-white px-8 py-3 rounded-2xl text-xs font-black uppercase tracking-widest shadow-blue active:scale-95 transition-transform">
                                {t('book_now')}
                              </button>
                            </div>
                          )
                        ) : (
                          <div className="space-y-4">
                            {doctorQueue.filter(a => a.status === 'seen' && a.patientName === profileData.name).length > 0 ? (
                              doctorQueue.filter(a => a.status === 'seen' && a.patientName === profileData.name).map(a => (
                                <div key={a.id} className="bg-input-bg/50 p-5 rounded-2xl border border-transparent hover:border-border-main transition-colors flex items-center justify-between">
                                   <div>
                                     <p className="text-sm font-black text-text-main mb-1">{a.doctor.name}</p>
                                     <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{formatFullDate(a.bookedAt)} • {a.reason}</p>
                                   </div>
                                   <div className="text-right">
                                      <span className="text-[9px] font-black text-green-600 uppercase tracking-widest bg-green-500/5 px-2 py-1 rounded">Fulfilled</span>
                                   </div>
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-text-muted text-center py-10 font-bold opacity-50 uppercase tracking-widest">No past visits recorded</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-16 flex flex-col md:flex-row gap-4 pt-10 border-t border-border-main">
                    <button 
                      onClick={() => goTo('settings')}
                      className="flex-1 bg-card-bg border border-border-main p-6 rounded-3xl flex items-center justify-between group hover:border-brand-blue transition-all"
                    >
                      <div className="flex items-center gap-4 font-black">
                        <Settings size={24} className="text-brand-blue" />
                        <span className="text-text-main text-base" data-i18n="settings">{t('settings')}</span>
                      </div>
                      <ChevronRight size={20} className="text-text-muted group-hover:translate-x-1 transition-transform" />
                    </button>
                    <button 
                      onClick={doLogout}
                      className="flex-1 border-2 border-red-100 text-red-500 p-6 rounded-3xl font-black flex items-center justify-center gap-3 hover:bg-red-50 active:scale-[0.98] transition-all"
                    >
                      <LogOut size={24} /> <span data-i18n="logout" className="text-base tracking-widest uppercase">{t('logout')}</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Screen: SETTINGS */}
            {currentScreen === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 overflow-y-auto no-scrollbar"
              >
                <div className="max-w-4xl mx-auto p-6 md:py-12">
                  <div className="flex items-center gap-6 mb-12">
                    <button onClick={goBack} className="bg-card-bg p-3 rounded-2xl border border-border-main shadow-sm hover:scale-105 transition-all">
                      <ChevronLeft size={20} className="text-text-muted" />
                    </button>
                    <h2 className="font-black text-2xl text-text-main" data-i18n="settings">{t('settings')}</h2>
                  </div>

                  <div className="grid md:grid-cols-2 gap-12">
                    <div className="space-y-10">
                      <section>
                        <h5 className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-6" data-i18n="appearance">{t('appearance')}</h5>
                        <div className="bg-card-bg border border-border-main rounded-[32px] p-8 flex items-center justify-between shadow-sm">
                           <div>
                             <p className="text-base font-black text-text-main mb-1" data-i18n="dark_mode">{t('dark_mode')}</p>
                             <p className="text-xs text-text-muted font-bold" data-i18n="dark_mode_sub">{t('dark_mode_sub')}</p>
                           </div>
                           <div 
                             className="toggle-track scale-110" 
                             role="switch" 
                             data-on={settings.darkMode} 
                             onClick={() => {
                               const next = !settings.darkMode;
                               toggleSetting('darkMode');
                               setTheme(next ? 'dark' : 'light');
                             }}
                           >
                             <div className="toggle-knob" />
                           </div>
                        </div>
                      </section>

                      <section>
                        <h5 className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-6" data-i18n="notifications">{t('notifications')}</h5>
                        <div className="bg-card-bg border border-border-main rounded-[32px] overflow-hidden shadow-sm">
                           <div className="p-8 flex items-center justify-between border-b border-border-main">
                              <div>
                                <p className="text-base font-black text-text-main mb-1" data-i18n="app_alerts">{t('app_alerts')}</p>
                                <p className="text-xs text-text-muted font-bold" data-i18n="app_alerts_sub">{t('app_alerts_sub')}</p>
                              </div>
                              <div className="toggle-track" role="switch" data-on={settings.appAlerts} onClick={() => toggleSetting('appAlerts')}>
                                <div className="toggle-knob" />
                              </div>
                           </div>
                           <div className="p-8 flex items-center justify-between">
                              <div>
                                <p className="text-base font-black text-text-main mb-1" data-i18n="gmail_reminders">{t('gmail_reminders')}</p>
                                <p className="text-xs text-text-muted font-bold" data-i18n="gmail_reminders_sub">{t('gmail_reminders_sub')}</p>
                              </div>
                              <div className="toggle-track" role="switch" data-on={settings.gmailReminders} onClick={() => toggleSetting('gmailReminders')}>
                                <div className="toggle-knob" />
                              </div>
                           </div>
                        </div>
                      </section>
                    </div>

                    <div className="space-y-10">
                      <section>
                        <h5 className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-6">{t('language')}</h5>
                         <div className="bg-card-bg border border-border-main rounded-[32px] p-8 shadow-sm">
                            <p onClick={() => setEditingField(editingField === 'lang-picker' ? null : 'lang-picker')} className="text-base font-black text-text-main flex justify-between items-center cursor-pointer group">
                              <span data-i18n="language">Global Preference</span>
                              <span className="text-brand-blue group-hover:underline">{settings.language} ∨</span>
                            </p>
                            
                            <AnimatePresence>
                              {editingField === 'lang-picker' && (
                                <motion.div 
                                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                  className="mt-6 space-y-2 overflow-hidden"
                                >
                                   {['English', 'हिंदी', 'ଓଡ଼ିଆ'].map(l => (
                                     <button 
                                      key={l}
                                      onClick={() => {
                                        setSettings(s => ({ ...s, language: l as any }));
                                        setEditingField(null);
                                        showToast(CheckCircle2, "Language synchronized");
                                      }}
                                      className={`lang-opt bg-input-bg text-text-main border-2 transition-all p-5 rounded-2xl w-full text-left font-black text-xs uppercase tracking-widest ${settings.language === l ? 'border-brand-blue' : 'border-transparent'}`}
                                     >
                                       {l === 'English' ? '🇬🇧 English' : l === 'हिंदी' ? '🇮🇳 हिंदी' : '🏛️ ଓଡ଼ିଆ'}
                                     </button>
                                   ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                         </div>
                      </section>

                      <section>
                        <h5 className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-6">Environment</h5>
                        <div className="bg-card-bg border border-border-main rounded-[32px] overflow-hidden shadow-sm">
                           <div className="p-8 border-b border-border-main flex justify-between items-center">
                              <div>
                                <p className="text-base font-black text-text-main">📍 Clinic Region</p>
                                <p className="text-xs text-text-muted font-bold">Standard service area</p>
                              </div>
                              <input 
                                className="text-right bg-input-bg px-4 py-2 rounded-xl text-brand-blue text-xs font-black uppercase outline-none"
                                defaultValue={settings.defaultCity}
                                onBlur={(e) => setSettings(s => ({ ...s, defaultCity: e.target.value }))}
                              />
                           </div>
                           <button onClick={() => setIsRatingModalOpen(true)} className="w-full p-8 text-left group hover:bg-input-bg transition-colors flex items-center justify-between">
                              <div>
                                <p className="text-base font-black text-text-main uppercase tracking-widest">Rate Platform</p>
                                <p className="text-xs text-text-muted font-bold">Help us improve the experience</p>
                              </div>
                              <Star size={20} className="text-yellow-400" />
                           </button>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {/* Screen: HOME */}
            {currentScreen === 'home' && (
              <motion.div 
                key="home"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 overflow-y-auto no-scrollbar pb-20"
              >
                <div className="max-w-4xl mx-auto px-6 py-10">
                  {isRefreshing && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 40, opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="flex justify-center items-center mb-6"
                    >
                      <div className="w-5 h-5 border-2 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
                    </motion.div>
                  )}

                  <div className="flex justify-between items-center mb-10">
                    <h2 className="text-2xl font-serif text-brand-blue tracking-tight" data-i18n="doc_connect">DOC-CONNECT</h2>
                    <div className="flex items-center gap-3">
                      <p className="hidden md:block text-sm font-bold text-text-muted">{formatFullDate(currentTime)}</p>
                      <button onClick={() => goTo('profile')} className="w-12 h-12 bg-card-bg border border-border-main rounded-xl flex items-center justify-center text-brand-blue text-sm font-black shadow-sm active:scale-95 transition-transform">
                        {profileData.initials || '?'}
                      </button>
                    </div>
                  </div>

                  {/* EMERGENCY SECTION */}
                  <div className="mb-12">
                    <div className="bg-red-500 rounded-[40px] p-8 text-white shadow-2xl shadow-red-500/10 flex flex-col md:flex-row items-center justify-between gap-8 overflow-hidden relative group transition-all">
                      <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/5 rounded-full blur-3xl group-hover:scale-125 transition-transform" />
                      <div className="flex items-center gap-8 relative z-10">
                        <div className="bg-white/20 p-5 rounded-3xl animate-[pulse_2s_infinite]">
                          <Ambulance size={40} strokeWidth={2.5} />
                        </div>
                        <div>
                          <h4 className="text-2xl font-black uppercase tracking-tight mb-1" data-i18n="emergency_support">{t('emergency_support')}</h4>
                          <p className="text-sm font-bold opacity-70 tracking-wide" data-i18n="emergency_desc">{t('emergency_desc')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 w-full md:w-auto relative z-10">
                        <button 
                          onClick={() => window.open('tel:102')}
                          className="flex-1 md:flex-none bg-white text-red-600 px-10 py-5 rounded-3xl font-black text-sm uppercase tracking-widest shadow-xl active:scale-95 transition-all hover:bg-neutral-50 flex items-center justify-center gap-2"
                        >
                          <PhoneCall size={18} />
                          <span data-i18n="call_ambulance">{t('call_ambulance')}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-10">
                    <div className="space-y-8">
                      <div className="bg-gradient-to-br from-brand-blue to-brand-dark rounded-[40px] p-10 text-white shadow-2xl relative overflow-hidden group">
                        <div className="relative z-10">
                          <p className="text-2xl font-serif mb-4 user-firstname-display">
                            {t('hi_greeting')} {profileData.name.trim().split(' ')[0] || 'User'} 👋
                          </p>
                          <div className="flex items-end gap-3 mb-8">
                            <h3 className="text-6xl font-black tracking-tighter tabular-nums leading-none">{formatHHMM(currentTime).split(' ')[0]}</h3>
                            <span className="text-lg font-black uppercase opacity-60 mb-2">{formatHHMM(currentTime).split(' ')[1]}</span>
                          </div>
                          <p className="text-xs uppercase tracking-[0.3em] font-black opacity-40">{formatFullDate(currentTime)}</p>
                        </div>
                        <motion.div 
                          animate={{ scale: [1, 1.1, 1], rotate: [0, 5, 0] }}
                          transition={{ repeat: Infinity, duration: 20 }}
                          className="absolute -bottom-10 -right-10 w-64 h-64 bg-white/5 rounded-full blur-3xl group-hover:bg-white/10 transition-all"
                        />
                      </div>

                      {bookingStatus && bookingStatus.status === 'booked' && (
                        <motion.button 
                          initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          onClick={() => goTo('token')}
                          className="w-full bg-teal-500 rounded-[32px] p-8 text-white flex items-center justify-between shadow-xl hover:shadow-teal-500/20 active:scale-[0.98] transition-all"
                        >
                          <div className="flex items-center gap-6">
                            <div className="bg-white/20 p-4 rounded-2xl">
                              <Clock size={28} />
                            </div>
                            <div className="text-left">
                              <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-2">Active Appointment</p>
                              <p className="text-xl font-black">{bookingStatus?.doctor?.name}</p>
                              <p className="text-xs font-bold opacity-60">Token {bookingStatus?.id} · {formatHHMM(bookingStatus.bookedAt)}</p>
                            </div>
                          </div>
                          <div className="bg-white text-teal-600 p-3 rounded-full shadow-lg">
                            <ChevronRight size={20} />
                          </div>
                        </motion.button>
                      )}

                      <div className="grid grid-cols-2 gap-6">
                        <button 
                          onClick={() => goTo('doctors')}
                          className="bg-card-bg p-8 rounded-[40px] border border-border-main shadow-sm flex flex-col gap-6 text-left group hover:border-brand-blue hover:shadow-xl transition-all"
                        >
                          <div className="bg-brand-light p-4 rounded-3xl group-hover:scale-110 transition-transform self-start">
                            <Search className="text-brand-blue" size={28} />
                          </div>
                          <div>
                            <h4 className="font-black text-text-main text-lg leading-tight" data-i18n="find_doctor">{t('find_doctor')}</h4>
                            <p className="text-xs text-text-muted font-bold uppercase tracking-widest mt-1 opacity-60">Book instantly</p>
                          </div>
                        </button>
                        <button 
                          onClick={() => goTo('token')}
                          className="bg-card-bg p-8 rounded-[40px] border border-border-main shadow-sm flex flex-col gap-6 text-left group hover:border-brand-blue hover:shadow-xl transition-all"
                        >
                          <div className="bg-brand-light p-4 rounded-3xl group-hover:scale-110 transition-transform self-start">
                            <Clock className="text-brand-blue" size={28} />
                          </div>
                          <div>
                            <h4 className="font-black text-text-main text-lg leading-tight" data-i18n="my_token">{t('my_token')}</h4>
                            <p className="text-xs text-text-muted font-bold uppercase tracking-widest mt-1 opacity-60">Live Tracking</p>
                          </div>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div>
                        <div className="flex justify-between items-center mb-6">
                          <h5 className="text-text-main text-lg font-black" data-i18n="available_now">{t('available_now')}</h5>
                          <button onClick={() => goTo('doctors')} className="text-brand-blue text-xs font-black uppercase tracking-widest hover:underline">View All</button>
                        </div>
                        <div className="space-y-4">
                          {doctors.map(doc => (
                            <div key={doc.id} className="bg-card-bg p-6 rounded-[32px] border border-border-main shadow-sm flex items-center gap-6 transition-all hover:border-brand-blue/30 group">
                              <div className="text-4xl bg-input-bg w-16 h-16 flex items-center justify-center rounded-2xl transition-transform group-hover:scale-110 shrink-0">{doc.emoji}</div>
                              <div className="flex-1 min-w-0">
                                <p className="font-black text-text-main text-base truncate">{doc.name}</p>
                                <p className="text-xs text-text-muted font-bold uppercase tracking-widest mt-1">{doc.specialty}</p>
                              </div>
                              <button 
                                onClick={() => { setSelectedDoctor(doc); goTo('book'); }} 
                                className="bg-brand-blue text-white text-xs font-black px-6 py-3 rounded-2xl active:scale-95 transition-transform shadow-blue"
                                data-i18n="book_now"
                              >
                                {t('book_now').split(' ')[0]}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                     <div className="bg-brand-light/30 p-8 rounded-[40px] border border-brand-light shadow-inner">
                         <h6 className="font-black text-brand-blue text-sm uppercase tracking-[0.2em] mb-4">Quick Stats</h6>
                         <div className="flex gap-10">
                            <div>
                               <p className="text-[10px] font-black text-text-muted uppercase mb-1">Queue Avg</p>
                               <p className="text-3xl font-black text-text-main tabular-nums">{profileData.waitMins || 10}<span className="text-sm font-bold ml-1 opacity-40">min</span></p>
                            </div>
                            <div className="w-px h-12 bg-brand-blue/10"></div>
                            <div>
                               <p className="text-[10px] font-black text-text-muted uppercase mb-1">Active Now</p>
                               <p className="text-3xl font-black text-text-main tabular-nums">{doctorQueue.filter(a => a.status === 'booked').length}</p>
                            </div>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}


            {/* Screen: DOCTOR LIST */}
            {currentScreen === 'doctors' && (
              <motion.div 
                key="doctors"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 overflow-y-auto no-scrollbar"
              >
                <div className="max-w-4xl mx-auto p-6 md:py-12">
                  <div className="flex items-center gap-6 mb-12">
                    <button onClick={goBack} className="bg-card-bg p-3 rounded-2xl border border-border-main shadow-sm hover:scale-105 active:scale-95 transition-all">
                      <ChevronLeft size={20} className="text-text-muted" />
                    </button>
                    <div>
                      <h2 className="font-black text-2xl text-text-main" data-i18n="choose_doctor">{t('choose_doctor')}</h2>
                      <p className="text-[10px] text-text-muted font-black uppercase tracking-[0.2em] mt-1 opacity-60">Verified Specialists • {settings.defaultCity}</p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-4 gap-8">
                    <aside className="md:col-span-1 space-y-6">
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                        <input 
                          className="w-full bg-card-bg border border-border-main rounded-2xl py-3.5 pl-12 pr-4 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-blue/20 transition-all placeholder:text-text-muted/40 font-bold" 
                          placeholder="Search..." 
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <p className="text-[9px] font-black uppercase text-text-muted tracking-[0.2em] mb-4">Categories</p>
                        {['All', 'Physician', 'Kids', 'Dermato', 'Gastro'].map(cat => (
                          <button 
                            key={cat} 
                            onClick={() => setSelectedCategory(cat)}
                            className={`w-full text-left px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${cat === selectedCategory ? 'bg-brand-blue text-white shadow-blue' : 'bg-transparent text-text-muted hover:bg-brand-light/50'}`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>

                      <div className="pt-6 border-t border-border-main/50">
                        <p className="text-[9px] font-black uppercase text-text-muted tracking-[0.2em] mb-4">Availability</p>
                        <button 
                          onClick={() => setAvailableOnly(!availableOnly)}
                          className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl border transition-all ${availableOnly ? 'bg-green-500/5 border-green-500/30' : 'bg-transparent border-border-main hover:bg-brand-light/50'}`}
                        >
                          <span className={`text-[10px] font-black uppercase tracking-widest ${availableOnly ? 'text-green-600' : 'text-text-muted'}`}>Available Now</span>
                          <div className={`w-8 h-4 rounded-full relative transition-colors ${availableOnly ? 'bg-green-500' : 'bg-input-bg'}`}>
                             <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${availableOnly ? 'right-1' : 'left-1'}`} />
                          </div>
                        </button>
                      </div>
                    </aside>

                    <div className="md:col-span-3 space-y-6 pb-20">
                      {(searchQuery && doctors.length > 0 && !doctors.some(d => 
                        d.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        d.specialty.toLowerCase().includes(searchQuery.toLowerCase())
                      )) && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-brand-blue/5 border border-brand-blue/20 p-4 rounded-2xl flex items-center gap-4"
                        >
                          <Info size={16} className="text-brand-blue" />
                          <p className="text-[10px] font-black text-brand-blue uppercase tracking-widest">Showing nearby available doctors in {settings.defaultCity}</p>
                        </motion.div>
                      )}

                      {isLoadingDoctors ? (
                        [1, 2, 3, 4].map(i => (
                          <div key={i} className="bg-card-bg p-6 rounded-[40px] border border-border-main shadow-sm h-40 animate-pulse" />
                        ))
                      ) : filteredDoctors.length > 0 ? (
                        <div className="grid md:grid-cols-1 gap-6">
                           {filteredDoctors.map(doc => (
                            <div key={doc.id} className="bg-card-bg p-8 rounded-[40px] border border-border-main shadow-xl shadow-blue/5 relative transition-all hover:border-brand-blue/30 group flex flex-col md:flex-row gap-8 items-start md:items-center">
                              <div className="absolute top-8 right-8 flex flex-col items-end gap-2">
                                <div className="px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-brand-light/50 text-brand-blue flex items-center gap-1.5">
                                  <Clock size={12} />
                                  {doc.waitMins}m wait
                                </div>
                                <div className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 bg-amber-100 text-amber-700">
                                  <Star size={10} fill="currentColor" />
                                  {doc.rating}
                                </div>
                              </div>

                              <div className="relative shrink-0">
                                <div className="text-5xl w-24 h-24 bg-bg-main flex items-center justify-center rounded-[32px] leading-none transition-transform group-hover:scale-110 shadow-inner">
                                  {doc.emoji}
                                </div>
                                {doc.availability && (
                                  <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 border-4 border-card-bg rounded-full shadow-sm" />
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <h4 className="font-black text-text-main text-2xl leading-tight mb-1">{doc.name}</h4>
                                <p className="text-xs text-brand-blue font-black uppercase tracking-[0.2em] mb-4">{doc.specialty}</p>
                                
                                <div className="flex flex-wrap gap-x-6 gap-y-3">
                                  <div className="flex items-center gap-2 text-text-muted font-bold">
                                    <MapPin size={14} className="text-brand-blue/60" />
                                    <span className="text-[11px] uppercase tracking-wider">{doc.location}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-text-muted font-bold">
                                    <Users size={14} className="text-brand-blue/60" />
                                    <span className="text-[11px] uppercase tracking-wider">{doc.queueCount}/{doc.maxCapacity} in queue</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-text-muted font-bold">
                                    <Activity size={14} className="text-brand-blue/60" />
                                    <span className="text-[11px] uppercase tracking-wider">{doc.experience}y Exp.</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col gap-3 w-full md:w-auto">
                                <p className="text-center md:text-right font-black text-brand-blue text-xl tabular-nums">₹{doc.price}</p>
                                <button 
                                  onClick={() => { setSelectedDoctor(doc); goTo('book'); }}
                                  className="w-full md:w-auto px-10 bg-brand-blue text-white font-black py-4 rounded-2xl shadow-blue active:scale-95 transition-all uppercase tracking-widest text-[11px]"
                                  data-i18n="book_now"
                                >
                                  {t('book_now')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="py-20 text-center flex flex-col items-center bg-card-bg rounded-[40px] border border-dashed border-border-main">
                           <Search size={64} className="text-text-muted opacity-10 mb-6" />
                           <p className="font-black text-text-main text-xl mb-2">No doctors found</p>
                           <p className="text-sm text-text-muted mb-8 max-w-[280px] font-medium leading-relaxed">We couldn't find any specialists matching your search in {settings.defaultCity}.</p>
                           <button onClick={() => setSearchQuery('')} className="bg-brand-blue text-white px-10 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-blue active:scale-95 transition-transform">Clear filters</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Screen: BOOK APPOINTMENT */}
            {currentScreen === 'book' && selectedDoctor && (
              <motion.div 
                key="book"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 overflow-y-auto no-scrollbar"
              >
                <div className="max-w-4xl mx-auto p-6 md:py-12">
                  <div className="flex items-center gap-6 mb-12">
                    <button onClick={() => goTo('doctors')} className="bg-card-bg p-3 rounded-2xl border border-border-main shadow-sm hover:scale-105 transition-all">
                      <ChevronLeft size={20} className="text-text-muted" />
                    </button>
                    <h2 className="font-black text-2xl text-text-main" data-i18n="book_slot">{t('book_slot')}</h2>
                  </div>

                  <div className="grid md:grid-cols-2 gap-12">
                    <div className="space-y-8">
                      <div className="bg-card-bg border border-border-main p-8 rounded-[40px] flex items-center gap-8 shadow-sm">
                        <div className="text-5xl bg-screen-bg w-24 h-24 flex items-center justify-center rounded-3xl shrink-0 shadow-inner">{selectedDoctor.emoji}</div>
                        <div className="flex-1">
                          <p className="text-[10px] text-text-muted font-black uppercase tracking-[0.2em] mb-2">Primary Consultant</p>
                          <h4 className="font-black text-text-main text-2xl mb-1">{selectedDoctor.name}</h4>
                          <p className="text-xs text-text-muted font-bold uppercase tracking-widest opacity-60">{selectedDoctor.specialty} · {selectedDoctor.clinic}</p>
                        </div>
                      </div>

                      <div className="bg-brand-light/30 p-8 rounded-[40px] border border-brand-light shadow-inner">
                        <div className="flex flex-col mb-6 gap-3">
                          <h5 className="text-[10px] font-black text-brand-blue uppercase tracking-[0.2em]">Select Arrival Date & Time</h5>
                          <input 
                            type="date"
                            value={bookingDate.toISOString().split('T')[0]}
                            onChange={(e) => {
                              const d = new Date(e.target.value);
                              if (!isNaN(d.getTime())) setBookingDate(d);
                              setSelectedTimeSlot(null); // Reset time slot on date change
                            }}
                            min={new Date().toISOString().split('T')[0]}
                            className="bg-card-bg border border-brand-blue/20 p-4 rounded-2xl text-text-main font-bold focus:outline-none focus:ring-2 focus:ring-brand-blue/50 text-sm w-full uppercase tracking-wider"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4 max-h-[300px] overflow-y-auto no-scrollbar pr-2 h-full">
                        {availableTimeSlots.map((slot, i) => (
                          <button 
                            key={slot.t} 
                            disabled={slot.s === 'full'}
                            onClick={() => setSelectedTimeSlot(slot.t)}
                            className={`p-6 rounded-3xl border-2 font-black text-base transition-all ${
                              slot.s === 'full' 
                                ? 'bg-input-bg border-border-main text-text-muted opacity-30 cursor-not-allowed' 
                                : selectedTimeSlot === slot.t
                                  ? 'bg-brand-blue border-brand-blue text-white shadow-blue active:scale-95' 
                                  : 'bg-card-bg border-border-main text-text-main shadow-sm hover:border-brand-blue active:scale-95'
                            }`}
                          >
                            {slot.t}
                            <p className="text-[9px] uppercase mt-1 opacity-60 tracking-widest">{slot.s === 'full' ? 'Sold Out' : 'Available'}</p>
                          </button>
                        ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-10">
                      <div className="space-y-6">
                        <div>
                          <h5 className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-4" data-i18n="visit_reason">Primary Complaint</h5>
                          <textarea className="w-full bg-card-bg border border-border-main rounded-3xl p-6 text-base text-text-main focus:outline-none focus:ring-4 focus:ring-brand-blue/10 transition-all font-bold placeholder:opacity-30" rows={4} placeholder="e.g. chronic headache since morning, mild fever..." />
                        </div>
                        <div>
                          <h5 className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                            <Mail size={14} className="text-brand-blue" />
                            Notification Channel
                          </h5>
                          <input className="w-full bg-card-bg border border-border-main rounded-2xl py-5 px-6 text-base font-black text-text-main focus:outline-none focus:ring-4 focus:ring-brand-blue/10 transition-all" defaultValue={profileData.email} />
                        </div>
                      </div>

                      <button 
                        onClick={confirmBooking}
                        disabled={!selectedTimeSlot}
                        className={`w-full font-black py-6 rounded-[32px] flex flex-col items-center gap-1 transition-all ${
                          !selectedTimeSlot 
                            ? 'bg-input-bg text-text-muted cursor-not-allowed opacity-50' 
                            : 'bg-brand-blue text-white shadow-blue active:scale-95 group'
                        }`}
                      >
                        <span className="text-lg tracking-widest uppercase" data-i18n="confirm_booking">{t('confirm_booking')}</span>
                        {selectedTimeSlot ? (
                          <span className="text-[10px] opacity-60 font-black uppercase tracking-[0.2em]">Estimated Wait Time: {getWaitMinsText(selectedDoctor.queueCount, selectedDoctor.waitMins)}</span>
                        ) : (
                          <span className="text-[10px] opacity-60 font-black uppercase tracking-[0.2em]">Please select a time slot</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Screen: SUCCESS */}
            {currentScreen === 'success' && bookingStatus && (
              <motion.div 
                key="success"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 flex flex-col overflow-y-auto no-scrollbar"
              >
                <div className="max-w-xl mx-auto w-full p-8 md:py-20 flex flex-col items-center text-center">
                  <div className="mb-10 relative">
                    <motion.div 
                      initial={{ scale: 0 }} animate={{ scale: 1 }} 
                      transition={{ type: 'spring', damping: 10, stiffness: 100 }}
                      className="bg-green-500 text-white p-10 rounded-full shadow-2xl relative z-10"
                    >
                      <CheckCircle2 size={80} strokeWidth={2.5} />
                    </motion.div>
                    <motion.div 
                      animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                      className="absolute inset-0 bg-green-500 rounded-full blur-2xl"
                    />
                  </div>
                  
                  <h2 className="text-4xl font-serif text-text-main mb-4 tracking-tight">Booking Confirmed!</h2>
                  <p className="text-base font-bold text-text-muted mb-12 max-w-[320px]" data-i18n="confirm_sub">We've synchronized with the clinic database. Your spot is secured.</p>

                  <div className="bg-card-bg border border-border-main rounded-[48px] p-10 w-full shadow-2xl mb-12 relative overflow-hidden">
                    <div className="absolute -top-6 -right-6 opacity-5 p-10">
                      <Stethoscope size={120} />
                    </div>
                    <p className="text-[11px] font-black text-brand-blue uppercase tracking-[0.2em] mb-6">Queue Token</p>
                    <h3 className="text-8xl font-black text-brand-blue mb-10 tracking-tighter tabular-nums leading-none select-none">{bookingStatus?.id}</h3>
                    
                    <div className="space-y-4 pt-10 border-t border-border-main/50">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-text-muted font-black uppercase tracking-widest">Specialist</span>
                        <span className="text-sm text-text-main font-black">{bookingStatus?.doctor?.name || 'Doctor'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-text-muted font-black uppercase tracking-widest">Est. Check-in</span>
                        <span className="text-sm font-black text-brand-blue">
                          {(() => {
                             if (!bookingStatus) return '--:-- Today';
                             const posIndex = activeQueue.findIndex(a => a.id === bookingStatus.id);
                             const waitMins = getDoctorWaitMins(bookingStatus.doctor?.id);
                             const estTime = getEstCheckinTime(posIndex, waitMins, bookingStatus.bookedAt);
                             return estTime ? `${formatHHMM(estTime)} Today` : '--:-- Today';
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mb-12 text-left">
                    <div className="bg-brand-blue/5 p-6 rounded-3xl flex items-center gap-4 border border-brand-blue/10">
                      <div className="bg-brand-blue p-2 rounded-xl text-white">
                        <Bell size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-black text-text-main mb-0.5">Dynamic Alerts</p>
                        <p className="text-[10px] text-text-muted font-bold uppercase tracking-tight">Active tracking enabled</p>
                      </div>
                    </div>
                    <div className="bg-green-500/5 p-6 rounded-3xl flex items-center gap-4 border border-green-500/10">
                      <div className="bg-green-500 p-2 rounded-xl text-white">
                        <Mail size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-black text-green-900 mb-0.5">Email Receipt</p>
                        <p className="text-[10px] text-green-800/60 font-bold uppercase tracking-tight">Sent to your inbox</p>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => goTo('token')}
                    className="w-full bg-brand-blue text-white font-black py-6 rounded-[32px] shadow-blue hover:scale-[1.02] active:scale-95 transition-all text-sm uppercase tracking-widest"
                  >
                    Enter Live Tracker →
                  </button>
                </div>
              </motion.div>
            )}

            {/* Screen: TOKEN TRACKER */}
            {currentScreen === 'token' && bookingStatus && (
              <motion.div 
                key="token"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 overflow-y-auto no-scrollbar"
              >
                <div className="max-w-4xl mx-auto p-6 md:py-16">
                  <div className="flex items-center gap-6 mb-12">
                    <button onClick={() => goTo('home')} className="bg-card-bg p-3 rounded-2xl border border-border-main shadow-sm hover:scale-105 transition-all">
                      <ChevronLeft size={20} className="text-text-muted" />
                    </button>
                    <h2 className="font-black text-2xl text-text-main" data-i18n="your_turn">{t('your_turn')}</h2>
                  </div>

                  <div className="grid md:grid-cols-2 gap-16">
                    <div className="space-y-10">
                      <div className="bg-gradient-to-br from-brand-blue to-brand-dark p-10 rounded-[48px] text-white shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-12 opacity-10 blur-sm group-hover:scale-110 transition-transform">
                          <Users size={120} />
                        </div>
                        <div className="relative z-10">
                          <p className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40 mb-6 font-mono">Verified Token</p>
                          <div className="flex justify-between items-start mb-10">
                            <div>
                              <h3 className="text-8xl font-black mb-2 tracking-tighter tabular-nums leading-none">{bookingStatus?.id}</h3>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-black uppercase tracking-widest opacity-60 px-1">{bookingStatus?.doctor?.name || 'Specialist'}</p>
                                {doctors.find(d => d.id === bookingStatus?.doctor?.id)?.status && (
                                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                    doctors.find(d => d.id === bookingStatus?.doctor?.id)?.status === 'open' 
                                      ? 'bg-green-500/20 border-green-500 text-green-200' 
                                      : 'bg-orange-500/20 border-orange-500 text-orange-200'
                                  }`}>
                                    {doctors.find(d => d.id === bookingStatus?.doctor?.id)?.status}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="bg-white/20 p-5 rounded-3xl backdrop-blur-xl border border-white/10">
                              <QrCode size={32} />
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-8 mb-12">
                            <div className="bg-white/5 p-6 rounded-[32px] border border-white/5">
                              <p className="text-[10px] font-black uppercase opacity-40 mb-3" data-i18n="now_serving">{t('now_serving')}</p>
                              <p className="text-3xl font-black tabular-nums tracking-tighter leading-none">
                                {activeQueue[0]?.id || '--'}
                              </p>
                            </div>
                            <div className="bg-white/5 p-6 rounded-[32px] border border-white/5">
                              <p className="text-[10px] font-black uppercase opacity-40 mb-3" data-i18n="people_ahead">{t('people_ahead')}</p>
                              <p className="text-3xl font-black tabular-nums tracking-tighter leading-none">
                                {bookingStatus ? Math.max(0, activeQueue.findIndex(a => a.id === bookingStatus?.id)) : 0}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="flex justify-between text-[11px] font-black uppercase tracking-[0.2em] opacity-50 px-1">
                              <span>Clinic Flow</span>
                              <span>
                                {(() => {
                                   if (!bookingStatus) return 'Calculating...';
                                   const posIndex = activeQueue.findIndex(a => a.id === bookingStatus.id);
                                   const waitMins = getDoctorWaitMins(bookingStatus.doctor?.id);
                                   const text = getWaitMinsText(posIndex, waitMins, bookingStatus.bookedAt);
                                   return posIndex > 0 ? `EXT Wait: ${text}` : text.toUpperCase();
                                })()}
                              </span>
                            </div>
                            <div className="h-3 bg-white/10 rounded-full overflow-hidden backdrop-blur-md p-[2px]">
                              <motion.div 
                                 initial={{ width: 0 }} 
                                 animate={{ 
                                   width: `${bookingStatus ? Math.min(100, (1 - (activeQueue.findIndex(a => a.id === bookingStatus?.id) / Math.max(1, activeQueue.length))) * 100) : 0}%` 
                                 }} 
                                 className="h-full bg-white rounded-full shadow-[0_0_20px_white]"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-brand-blue/5 p-8 rounded-[40px] border border-brand-blue/10 flex items-center gap-6 shadow-sm">
                        <div className="bg-brand-blue p-4 rounded-3xl text-white shadow-blue">
                          <BellRing size={28} />
                        </div>
                        <div>
                          <p className="text-lg font-black text-text-main mb-1" data-i18n="notifications_on">{t('notifications_on')}</p>
                          <p className="text-xs text-text-muted font-bold leading-relaxed">We'll ping your desktop and phone when you're 2 patients away.</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">
                       <h5 className="text-[11px] font-black text-text-muted uppercase tracking-[0.3em] mb-10 px-2 flex items-center gap-3">
                         <Activity size={18} className="text-brand-blue" />
                         Live Sequence Logs
                       </h5>
                       
                       <div className="space-y-0 relative pl-8">
                         <div className="absolute left-10 top-2 bottom-6 w-[2px] bg-border-main/50"></div>
                         
                         {[
                           { icon: CheckCircle2, time: bookingStatus?.createdAt ? formatHHMM(bookingStatus.createdAt) : (bookingStatus?.bookedAt ? formatHHMM(bookingStatus.bookedAt) : '--:--'), msg: 'Entry Synchronized', sub: 'Clinic check-in database updated', status: 'done' },
                           { icon: Mail, time: 'Synced', msg: `Confirmation Dispatched`, sub: `Email and SMS sent to your devices`, status: 'done' },
                           { icon: Bell, time: bookingStatus && Math.max(0, activeQueue.findIndex(a => a.id === bookingStatus.id)) <= 2 ? 'Sent' : 'Pending', msg: 'Almost Your Turn Alert', sub: 'Will trigger at Patient -2', status: bookingStatus && Math.max(0, activeQueue.findIndex(a => a.id === bookingStatus.id)) <= 2 ? 'done' : 'waiting' },
                           { icon: Stethoscope, time: bookingStatus && Math.max(0, activeQueue.findIndex(a => a.id === bookingStatus.id)) === 0 ? 'Now' : 'Upcoming', msg: `Clinic Entry Request`, sub: `Your code will be called by staff`, status: bookingStatus && Math.max(0, activeQueue.findIndex(a => a.id === bookingStatus.id)) === 0 ? 'done' : 'waiting' },
                         ].map((step, i) => (
                           <div key={i} className="flex gap-8 pb-14 relative group">
                             <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1 relative z-10 transition-all ${
                               step.status === 'done' ? 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]' : 'bg-card-bg border-4 border-border-main'
                             }`}>
                               {step.status === 'done' && <Check size={14} className="text-white" strokeWidth={4} />}
                             </div>
                             <div className="flex-1 pt-0.5">
                               <div className="flex justify-between items-center mb-1.5">
                                 <p className={`text-base font-black transition-colors ${step.status === 'done' ? 'text-text-main' : 'text-text-muted opacity-40'}`}>
                                   {step.msg}
                                 </p>
                                 <span className="text-[10px] font-black text-text-muted bg-input-bg px-2 py-0.5 rounded uppercase">{step.time}</span>
                               </div>
                               <p className={`text-xs font-bold leading-relaxed ${step.status === 'done' ? 'text-text-muted' : 'text-text-muted/20'}`}>
                                 {step.sub}
                               </p>
                             </div>
                           </div>
                         ))}
                       </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Screen: DOCTOR DASHBOARD */}
            {currentScreen === 'doctor-dashboard' && (
              <motion.div 
                key="doctor"
                initial={{ opacity: 0, scale: 0.98, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -15 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 overflow-y-auto no-scrollbar bg-screen-bg"
              >
                <div className="max-w-4xl mx-auto p-6 md:py-16">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-16">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-6 mb-6">
                         <div 
                           onClick={() => setEditingField('emoji')}
                           className="bg-brand-blue text-white w-20 h-20 rounded-[32px] flex items-center justify-center text-4xl font-black shadow-blue uppercase shrink-0 cursor-pointer hover:scale-105 transition-transform"
                         >
                           {editingField === 'emoji' ? (
                             <input 
                               autoFocus
                               className="w-12 bg-transparent text-center focus:outline-none"
                               defaultValue={profileData.emoji}
                               onBlur={(e) => saveProfileField('emoji', e.target.value)}
                               onKeyDown={(e) => e.key === 'Enter' && saveProfileField('emoji', e.currentTarget.value)}
                             />
                           ) : (
                             profileData.emoji || profileData.name?.charAt(0) || 'D'
                           )}
                         </div>
                         <div className="flex-1">
                            {editingField === 'name' ? (
                              <input 
                                autoFocus
                                className="text-3xl font-black text-brand-blue bg-transparent border-b-2 border-brand-blue focus:outline-none w-full"
                                defaultValue={profileData.name}
                                onBlur={(e) => saveProfileField('name', e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && saveProfileField('name', e.currentTarget.value)}
                              />
                            ) : (
                              <h2 onClick={() => setEditingField('name')} className="text-3xl font-black text-text-main user-name-display tracking-tight cursor-pointer hover:text-brand-blue transition-colors">
                                 {profileData.name || 'Dr. Name'}
                              </h2>
                            )}
                            
                            <div className="flex flex-wrap items-center gap-3 mt-3">
                              {editingField === 'specialty' ? (
                                <input 
                                  autoFocus
                                  className="text-[10px] font-black text-brand-blue bg-brand-blue/5 px-2 py-0.5 rounded border border-brand-blue/20 outline-none"
                                  defaultValue={profileData.specialty}
                                  onBlur={(e) => saveProfileField('specialty', e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && saveProfileField('specialty', e.currentTarget.value)}
                                />
                              ) : (
                                <span onClick={() => setEditingField('specialty')} className="text-[10px] font-black text-brand-blue uppercase tracking-[0.2em] bg-brand-blue/10 px-2 py-0.5 rounded cursor-pointer hover:bg-brand-blue/20 transition-colors">
                                  {profileData.specialty || 'General Surgeon'}
                                </span>
                              )}
                              
                              <span className="opacity-40 select-none">|</span>
                              
                              {editingField === 'regNo' ? (
                                <input 
                                  autoFocus
                                  className="text-[10px] font-black text-brand-blue bg-transparent border-b border-brand-blue/20 outline-none"
                                  defaultValue={profileData.regNo}
                                  onBlur={(e) => saveProfileField('regNo', e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && saveProfileField('regNo', e.currentTarget.value)}
                                />
                              ) : (
                                <span onClick={() => setEditingField('regNo')} className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] cursor-pointer hover:text-brand-blue transition-colors">
                                  Reg #{profileData.regNo || '880011'}
                                </span>
                              )}
                            </div>
                         </div>
                      </div>
                      
                      {editingField === 'clinic' ? (
                        <input 
                          autoFocus
                          className="text-xs text-brand-blue font-bold uppercase tracking-widest bg-transparent border-b border-brand-blue/20 outline-none w-full max-w-md"
                          defaultValue={profileData.clinic}
                          onBlur={(e) => saveProfileField('clinic', e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveProfileField('clinic', e.currentTarget.value)}
                        />
                      ) : (
                        <p onClick={() => setEditingField('clinic')} className="text-xs text-text-muted font-bold uppercase tracking-widest flex items-center gap-2 opacity-60 cursor-pointer hover:text-brand-blue transition-colors">
                          <MapPin size={14} className="text-brand-blue" /> {profileData.clinic || 'City Health Clinic'} · Building A · Suite 204
                        </p>
                      )}
                    </div>
                    
                    <div className="bg-card-bg border border-border-main p-6 rounded-[32px] flex items-center gap-10 shadow-sm shrink-0">
                       <div className="text-left shrink-0">
                          <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1.5">{formatFullDate(currentTime).split(',')[0]}</p>
                          <p className="text-3xl font-black text-brand-blue live-time tabular-nums leading-none">{formatHHMM(currentTime)}</p>
                       </div>
                       <div className="w-px h-10 bg-border-main"></div>
                       <button onClick={doLogout} className="bg-red-50 text-red-500 p-4 rounded-2xl hover:bg-red-100 transition-colors shadow-sm active:scale-95 transition-transform">
                          <LogOut size={20} />
                       </button>
                    </div>
                  </div>

                  <div className="flex bg-card-bg/50 backdrop-blur-xl border border-border-main p-2 rounded-[32px] mb-12 w-full md:w-fit self-center md:self-start">
                    <button 
                      onClick={() => setDocDashboardView('queue')}
                      className={`flex-1 md:flex-none px-10 py-4 rounded-3xl text-sm font-black transition-all ${docDashboardView === 'queue' ? 'bg-white text-brand-dark shadow-xl' : 'text-text-muted hover:text-text-main'}`}
                    >
                      Patients Queue
                    </button>
                    <button 
                      onClick={() => setDocDashboardView('schedule')}
                      className={`flex-1 md:flex-none px-10 py-4 rounded-3xl text-sm font-black transition-all ${docDashboardView === 'schedule' ? 'bg-white text-brand-dark shadow-xl' : 'text-text-muted hover:text-text-main'}`}
                    >
                      Calendar & Availability
                    </button>
                  </div>

                  {docDashboardView === 'queue' ? (
                    <>
                      <div className="grid md:grid-cols-3 gap-8 mb-16">
                    <div className="md:col-span-2 bg-gradient-to-br from-brand-blue to-brand-dark rounded-[48px] p-10 text-white shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-10 opacity-10 bg-white rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
                        <div className="relative z-10 flex justify-between items-start mb-12">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50 mb-4" data-i18n="clinic_status">{t('clinic_status')}</p>
                            <h3 className="text-5xl font-black uppercase tracking-tighter flex items-center gap-4">
                               {docStatus}
                               <span className={`w-4 h-4 rounded-full animate-pulse ${docStatus === 'open' ? 'bg-green-400' : 'bg-orange-400'}`}></span>
                            </h3>
                          </div>
                          <button className="bg-white/10 hover:bg-white/20 p-4 rounded-2xl backdrop-blur-xl transition-colors">
                            <Settings size={28} />
                          </button>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 relative z-10">
                           {['open', 'busy', 'break', 'closed'].map(s => (
                             <button 
                               key={s}
                               onClick={() => setDocStatusInFirebase(s as any)}
                               className={`py-6 rounded-[32px] border-2 transition-all flex flex-col items-center justify-center gap-4 ${
                                 docStatus === s 
                                   ? 'bg-white border-white text-brand-dark shadow-xl'
                                   : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:border-white/20'
                               }`}
                             >
                                <div className={`w-3 h-3 rounded-full ${docStatus === s ? 'bg-brand-blue' : 'bg-white/20'}`}></div>
                                <span className="text-[10px] font-black uppercase tracking-widest leading-none">{s}</span>
                             </button>
                           ))}
                        </div>
                    </div>

                    <div className="bg-card-bg border border-border-main rounded-[48px] p-10 shadow-sm flex flex-col justify-between">
                       <h6 className="text-[10px] font-black text-text-muted uppercase tracking-[0.3em] mb-10">Real-time Insights</h6>
                       <div className="space-y-8">
                          {[
                            { l: 'Total Registered', v: queueStats.total, c: 'text-text-main', i: Users },
                            { l: 'Currently Waiting', v: queueStats.waiting, c: 'text-orange-500', i: Clock },
                            { l: 'Successfully Seen', v: queueStats.seen, c: 'text-green-500', i: CheckCircle2 },
                          ].map(stat => (
                            <div key={stat.l} className="flex items-center gap-6">
                               <div className="bg-brand-light p-4 rounded-2xl">
                                  <stat.i size={20} className="text-brand-blue" />
                               </div>
                               <div>
                                  <p className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-1">{stat.l}</p>
                                  <p className={`text-4xl font-black leading-none tabular-nums ${stat.c}`}>{stat.v}</p>
                               </div>
                            </div>
                          ))}
                       </div>
                    </div>
                  </div>

                  <div className="bg-card-bg border border-border-main rounded-[48px] p-10 shadow-sm">
                    <div className="flex justify-between items-center mb-12">
                      <h5 className="font-black text-text-main text-2xl flex items-center gap-4">
                         Patient Trajectory
                         <span className="text-[11px] bg-brand-blue text-white px-4 py-1.5 rounded-full font-black uppercase tracking-widest shadow-blue">
                           {doctorQueue.filter(p => p.status === 'booked').length} Waiting In Queue
                         </span>
                      </h5>
                    </div>

                    <div className="space-y-6">
                      {doctorQueue.filter(p => userRole === 'doctor' || p.status === 'booked').length === 0 ? (
                        <div className="py-24 flex flex-col items-center justify-center text-text-muted/20 bg-input-bg/30 rounded-[40px] border-2 border-dashed border-border-main">
                          <Users size={80} strokeWidth={1} className="mb-6 opacity-30" />
                          <p className="font-black text-base uppercase tracking-[0.2em] opacity-40">Queue database is currently empty</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                          {doctorQueue.map((patient, i) => {
                            const waitingList = doctorQueue.filter(a => a.status === 'booked');
                            const pos = waitingList.findIndex(a => a.id === patient.id) + 1;
                            
                            return (
                              <div 
                                key={patient.id} 
                                className={`p-10 rounded-[48px] border transition-all flex flex-col md:flex-row items-center gap-10 ${
                                  patient.status === 'seen' 
                                    ? 'bg-input-bg/50 border-border-main grayscale opacity-40' 
                                    : pos === 1
                                      ? 'bg-brand-blue/5 border-brand-blue shadow-blue/5 shadow-2xl relative ring-2 ring-brand-blue/20'
                                      : 'bg-card-bg border-border-main shadow-sm hover:border-brand-blue/30'
                                }`}
                              >
                                {pos === 1 && patient.status === 'booked' && (
                                  <div className="absolute -top-3 left-10 bg-brand-blue text-white text-[9px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-blue">
                                    Live Session · Priority 1
                                  </div>
                                )}
                                
                                <div className="bg-bg-main w-24 h-24 rounded-[32px] flex items-center justify-center font-black text-brand-blue text-3xl shadow-inner shrink-0 leading-none">
                                  {patient.patientName.charAt(0)}
                                </div>
                                
                                <div className="flex-1 min-w-0 text-center md:text-left">
                                  <div className="flex flex-col md:flex-row md:items-center gap-3 mb-3">
                                    <h6 className="font-black text-text-main text-2xl">{patient.patientName}</h6>
                                    <span className="text-[10px] bg-brand-blue/10 text-brand-blue px-3 py-1 rounded-lg font-black uppercase tracking-widest self-center md:self-auto">Token {patient.id}</span>
                                  </div>
                                  <p className="text-sm text-text-muted font-bold uppercase tracking-widest opacity-60 mb-2 truncate">{patient.reason}</p>
                                  <div className="flex items-center justify-center md:justify-start gap-4">
                                     <div className="flex items-center gap-2 text-[10px] font-black text-text-muted uppercase">
                                        <Clock size={12} className="text-brand-blue" />
                                        <span>EST. Wait: {patient.status === 'seen' ? 'Completed' : (pos - 1 <= 0 ? 'Your turn now' : getWaitMinsText(pos - 1, profileData.waitMins || 10, patient.bookedAt))}</span>
                                     </div>
                                     <div className="flex items-center gap-2 text-[10px] font-black text-text-muted uppercase">
                                        <Activity size={12} className="text-brand-blue" />
                                        <span>Status: {patient.status}</span>
                                     </div>
                                  </div>
                                </div>

                                <div className="flex gap-4 w-full md:w-auto">
                                   {patient.status === 'booked' ? (
                                     <>
                                       <button 
                                         onClick={() => markDone(patient.id)}
                                         className="flex-1 md:flex-none md:min-w-[180px] bg-brand-blue text-white text-[11px] font-black uppercase tracking-widest py-6 rounded-3xl shadow-blue active:scale-95 transition-transform flex items-center justify-center gap-3 hover:bg-brand-dark"
                                       >
                                         <CheckCircle2 size={18} /> Mark as Seen
                                       </button>
                                       <button 
                                         onClick={() => callNext(patient.id)}
                                         className="bg-card-bg border border-border-main text-text-main p-6 rounded-3xl hover:border-brand-blue transition-colors flex items-center justify-center"
                                       >
                                          <Bell size={20} />
                                       </button>
                                     </>
                                   ) : (
                                      <div className="bg-green-500/5 text-green-600 px-8 py-6 rounded-3xl font-black text-[11px] uppercase tracking-widest border border-green-500/20">
                                         Consulation Finished at {formatHHMM(patient.seenAt!)}
                                      </div>
                                   )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                    </>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }} 
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-12 pb-20"
                    >
                      {/* Working Hours Editor */}
                      <div className="bg-card-bg border border-border-main rounded-[48px] p-10 shadow-sm">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                          <div>
                            <h5 className="font-black text-text-main text-2xl flex items-center gap-4">
                              Weekly Working Hours
                              <Clock className="text-brand-blue" size={24} />
                            </h5>
                            <p className="text-xs text-text-muted font-bold mt-1">Set your standard operational hours for each day.</p>
                          </div>
                          <button 
                            onClick={saveSchedule}
                            className="w-full md:w-auto bg-brand-blue text-white px-8 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-blue hover:bg-brand-dark transition-all"
                          >
                            Save Changes
                          </button>
                        </div>

                        <div className="grid gap-4">
                          {(Object.entries(profileData.schedule || DEFAULT_SCHEDULE) as [keyof DoctorSchedule, WorkingDay][]).map(([day, config]) => (
                            <div key={day} className="flex flex-col md:flex-row items-start md:items-center gap-6 p-6 rounded-3xl bg-input-bg/30 border border-border-main/50">
                              <div className="w-32">
                                <span className="font-black text-xs uppercase tracking-widest text-text-muted">{day}</span>
                              </div>
                              <div className="flex-1 flex flex-wrap items-center gap-8">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    checked={config.enabled} 
                                    onChange={(e) => updateScheduleDay(day as keyof DoctorSchedule, 'enabled', e.target.checked)}
                                    className="sr-only peer"
                                  />
                                  <div className="w-11 h-6 bg-border-main peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-blue"></div>
                                  <span className="ml-4 text-[10px] font-black uppercase text-text-muted">{config.enabled ? 'Working' : 'Off'}</span>
                                </label>
                                
                                <div className={`flex items-center gap-4 transition-opacity ${config.enabled ? 'opacity-100' : 'opacity-20 pointer-events-none'}`}>
                                  <input 
                                    type="time" 
                                    value={config.start} 
                                    onChange={(e) => updateScheduleDay(day as keyof DoctorSchedule, 'start', e.target.value)}
                                    className="bg-white border border-border-main px-4 py-2 rounded-xl text-xs font-bold font-mono focus:border-brand-blue outline-none"
                                  />
                                  <span className="text-text-muted text-xs">to</span>
                                  <input 
                                    type="time" 
                                    value={config.end} 
                                    onChange={(e) => updateScheduleDay(day as keyof DoctorSchedule, 'end', e.target.value)}
                                    className="bg-white border border-border-main px-4 py-2 rounded-xl text-xs font-bold font-mono focus:border-brand-blue outline-none"
                                  />
                                </div>
                                {config.enabled && (
                                   <div className="text-[10px] font-bold text-brand-blue opacity-60">
                                      {Math.floor((new Date(`1970-01-01T${config.end}`).getTime() - new Date(`1970-01-01T${config.start}`).getTime()) / 3600000)}h {( (new Date(`1970-01-01T${config.end}`).getTime() - new Date(`1970-01-01T${config.start}`).getTime()) % 3600000) / 60000}m
                                   </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Blocked Slots / Breaks */}
                      <div className="bg-card-bg border border-border-main rounded-[48px] p-10 shadow-sm relative overflow-hidden">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                          <div>
                            <h5 className="font-black text-text-main text-2xl flex items-center gap-4">
                              Breaks & Planned Time-Off
                              <Calendar className="text-brand-blue" size={24} />
                            </h5>
                            <p className="text-xs text-text-muted font-bold mt-1">Block off specific times for personal tasks or breaks.</p>
                          </div>
                          <button 
                            onClick={() => setIsAddingBlock(true)}
                            className="flex items-center gap-3 bg-brand-blue/10 text-brand-blue px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-brand-blue/20 transition-all"
                          >
                            <Plus size={18} /> Add Time-Off Block
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {(profileData.blockedSlots || []).length === 0 ? (
                            <div className="md:col-span-2 py-24 flex flex-col items-center justify-center text-text-muted/20 bg-input-bg/30 rounded-[40px] border-2 border-dashed border-border-main">
                              <Calendar size={64} strokeWidth={1} className="mb-6 opacity-20" />
                              <p className="font-black text-[11px] uppercase tracking-[0.2em] opacity-40 text-center px-10">No specific time-off periods defined yet</p>
                              <button onClick={() => setIsAddingBlock(true)} className="mt-6 text-brand-blue text-[10px] font-black uppercase tracking-widest hover:underline transition-all">Create your first block</button>
                            </div>
                          ) : (
                            (profileData.blockedSlots || []).map(block => (
                              <div key={block.id} className="p-8 rounded-[40px] border border-border-main bg-white/30 backdrop-blur-sm flex items-center justify-between group hover:border-brand-blue/30 transition-all shadow-sm">
                                <div className="flex items-center gap-6">
                                  <div className="bg-orange-500/10 p-4 rounded-2xl text-orange-500">
                                    <Clock size={20} />
                                  </div>
                                  <div>
                                    <p className="text-sm font-black text-text-main mb-1">{block.reason || 'Personal Time-Off'}</p>
                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
                                      <Calendar size={12} /> {formatFullDate(new Date(block.date))}
                                    </p>
                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-1 opacity-50">
                                       {formatHHMM(new Date(`${block.date}T${block.start}`))} - {formatHHMM(new Date(`${block.date}T${block.end}`))}
                                    </p>
                                  </div>
                                </div>
                                <button 
                                  onClick={() => removeBlockedSlot(block.id)}
                                  className="opacity-0 group-hover:opacity-100 p-4 rounded-2xl hover:bg-red-50 text-red-500 transition-all flex items-center justify-center"
                                >
                                  <Plus size={20} className="rotate-45" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <AnimatePresence>
                        {isAddingBlock && (
                          <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[300] bg-brand-dark/40 backdrop-blur-xl flex items-center justify-center p-6"
                          >
                            <motion.div 
                              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                              className="bg-white w-full max-w-lg rounded-[56px] p-12 shadow-2xl relative overflow-hidden"
                            >
                              <div className="absolute top-0 right-0 p-12 opacity-5">
                                <Calendar size={120} className="text-brand-blue" />
                              </div>

                              <h3 className="text-4xl font-black mb-2 tracking-tight">Block Schedule</h3>
                              <p className="text-sm text-text-muted font-bold mb-10 leading-relaxed uppercase tracking-widest opacity-40">Prevent bookings during this window</p>
                              
                              <div className="space-y-8 mb-12">
                                <div className="space-y-3">
                                  <label className="text-[11px] font-black uppercase tracking-widest text-text-muted px-2">Departure Date</label>
                                  <input 
                                    type="date"
                                    value={newBlock.date}
                                    onChange={(e) => setNewBlock(prev => ({ ...prev, date: e.target.value }))}
                                    className="w-full bg-input-bg border-2 border-transparent p-6 rounded-[32px] font-bold outline-none focus:border-brand-blue focus:bg-white transition-all shadow-sm"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-8">
                                  <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase tracking-widest text-text-muted px-2">Start Time</label>
                                    <input 
                                      type="time"
                                      value={newBlock.start}
                                      onChange={(e) => setNewBlock(prev => ({ ...prev, start: e.target.value }))}
                                      className="w-full bg-input-bg border-2 border-transparent p-6 rounded-[32px] font-bold outline-none focus:border-brand-blue focus:bg-white transition-all shadow-sm"
                                    />
                                  </div>
                                  <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase tracking-widest text-text-muted px-2">End Time</label>
                                    <input 
                                      type="time"
                                      value={newBlock.end}
                                      onChange={(e) => setNewBlock(prev => ({ ...prev, end: e.target.value }))}
                                      className="w-full bg-input-bg border-2 border-transparent p-6 rounded-[32px] font-bold outline-none focus:border-brand-blue focus:bg-white transition-all shadow-sm"
                                    />
                                  </div>
                                </div>
                                <div className="space-y-3">
                                  <label className="text-[11px] font-black uppercase tracking-widest text-text-muted px-2">Reason</label>
                                  <input 
                                    type="text"
                                    placeholder="e.g. Surgery, Seminar, Personal"
                                    value={newBlock.reason}
                                    onChange={(e) => setNewBlock(prev => ({ ...prev, reason: e.target.value }))}
                                    className="w-full bg-input-bg border-2 border-transparent p-6 rounded-[32px] font-bold outline-none focus:border-brand-blue focus:bg-white transition-all shadow-sm"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-6">
                                <button 
                                  onClick={() => setIsAddingBlock(false)}
                                  className="flex-1 bg-input-bg text-text-muted py-7 rounded-[32px] font-black text-[11px] uppercase tracking-[0.2em] hover:bg-border-main/20 transition-all"
                                >
                                  Discard
                                </button>
                                <button 
                                  onClick={addBlockedSlot}
                                  className="flex-1 bg-brand-blue text-white py-7 rounded-[32px] font-black text-[11px] uppercase tracking-[0.2em] shadow-blue hover:bg-brand-dark transition-all"
                                >
                                  Active Block
                                </button>
                              </div>
                            </motion.div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* GLOBAL EMERGENCY SOS (Only for Patients) */}
          {userRole === 'patient' && currentScreen !== 'login' && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="fixed bottom-36 right-10 z-[200] flex flex-col items-end gap-3 pointer-events-none"
            >
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => window.open('tel:102')}
                className="pointer-events-auto bg-red-600 text-white p-5 rounded-full shadow-[0_20px_50px_rgba(220,38,38,0.4)] border-4 border-white flex items-center justify-center relative overflow-hidden group"
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
                <Ambulance size={32} strokeWidth={2.5} className="relative z-10" />
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
              </motion.button>
              
              <div className="bg-text-main text-white px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl pointer-events-auto relative">
                <div className="absolute -top-1 right-8 w-2 h-2 bg-text-main rotate-45" />
                SOS Emergency
              </div>
            </motion.div>
          )}
      </main>
    </>
  )}
</div>
  );
}
