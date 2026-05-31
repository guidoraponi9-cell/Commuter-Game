import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Animated,
  Share,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Game constants ────────────────────────────────────────────
const OPERATORS = ['(', ')', '^', '+', '-', '*', '/'];
const STORAGE_HISTORY  = 'commuter_history_final_v16';
const STORAGE_DAILY    = 'commuter_daily_final_v16';
const STORAGE_STREAK   = 'commuter_streak_v1';
const STORAGE_BEST     = 'commuter_best_time_v1';
const TOTAL_SOLVABLE   = 7437;
const DAILY_GAME_EPOCH = '2025-01-01';
const NL = String.fromCharCode(10);

const ANALYSIS_CACHE   = new Map();
const EXPRESSION_CACHE = new Map();

// ── MTA brand colors (never modified) ────────────────────────
const MTA = {
  red:    '#ee352e',   // 1 2 3
  green:  '#00933c',   // 4 5 6
  blue:   '#2850ad',   // A C E
  purple: '#b933ad',   // 7
  yellow: '#fccc0a',   // N Q R W
  orange: '#ff6319',   // B D F M
};

export default function App() {
  // ── Screen / game state ───────────────────────────────────
  const [screen, setScreen]                         = useState('menu');
  const [digits, setDigits]                         = useState('2368');
  const [expression, setExpression]                 = useState('');
  const [solution, setSolution]                     = useState(null);
  const [history, setHistory]                       = useState([]);
  const [dailyState, setDailyState]                 = useState(null);
  const [showHelp, setShowHelp]                     = useState(false);
  const [showLivePrompt, setShowLivePrompt]         = useState(false);
  const [showRandomPrompt, setShowRandomPrompt]     = useState(false);
  const [liveInput, setLiveInput]                   = useState('');
  const [livePlayableMessage, setLivePlayableMessage] = useState('');
  const [inlineMessage, setInlineMessage]           = useState('');
  const [currentMeta, setCurrentMeta]               = useState(emptyMeta());
  const [selectedRandomDifficulty, setSelectedRandomDifficulty] = useState('simple');
  const [randomLoading, setRandomLoading]           = useState(false);
  const [showRevealedSolution, setShowRevealedSolution] = useState(false);
  const [successModal, setSuccessModal]             = useState({
    visible: false, title: '', subtitle: '',
    showShare: false, primaryLabel: 'Home', primaryAction: 'home',
  });
  const [dailyTimerSeconds, setDailyTimerSeconds]   = useState(0);
  const [dailyTimerStartedAt, setDailyTimerStartedAt] = useState(null);
  const [dailyTimerDateKey, setDailyTimerDateKey]   = useState(null);
  const [storageLoaded, setStorageLoaded]           = useState(false);

  // ── New: streak + best time ───────────────────────────────
  const [streak, setStreak]     = useState({ count: 0, lastDate: null });
  const [bestTime, setBestTime] = useState(null);

  const glow = useRef(new Animated.Value(0)).current;

  // ── Responsive layout ─────────────────────────────────────
  const { width: screenWidth } = Dimensions.get('window');
  const contentWidth = Math.min(screenWidth - 32, 540);

  // ── Effects ───────────────────────────────────────────────
  useEffect(() => { loadStored(); }, []);

  useEffect(() => {
    const meta = analyzeDigits(digits);
    setCurrentMeta(meta);
    setSolution(meta.solution);
  }, [digits]);

  useEffect(() => {
    let intervalId = null;
    if (
      screen === 'play-daily' &&
      dailyTimerStartedAt &&
      dailyState &&
      dailyState.dateKey === dailyTimerDateKey &&
      !dailyState.completedAt
    ) {
      intervalId = setInterval(() => {
        setDailyTimerSeconds(Math.floor((Date.now() - dailyTimerStartedAt) / 1000));
      }, 250);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [screen, dailyTimerStartedAt, dailyState, dailyTimerDateKey]);

  // ── Storage ───────────────────────────────────────────────
  async function loadStored() {
    try {
      const [historyRaw, dailyRaw, streakRaw, bestRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_HISTORY),
        AsyncStorage.getItem(STORAGE_DAILY),
        AsyncStorage.getItem(STORAGE_STREAK),
        AsyncStorage.getItem(STORAGE_BEST),
      ]);

      if (historyRaw) setHistory(JSON.parse(historyRaw));
      if (streakRaw)  setStreak(JSON.parse(streakRaw));
      if (bestRaw)    setBestTime(JSON.parse(bestRaw));

      const today = getTodayKey();
      if (dailyRaw) {
        const parsed = JSON.parse(dailyRaw);
        if (parsed && parsed.dateKey === today) {
          setDailyState(parsed);
        } else {
          const fresh = createDailyState(today);
          setDailyState(fresh);
          await AsyncStorage.setItem(STORAGE_DAILY, JSON.stringify(fresh));
        }
      } else {
        const fresh = createDailyState(today);
        setDailyState(fresh);
        await AsyncStorage.setItem(STORAGE_DAILY, JSON.stringify(fresh));
      }
    } catch (e) {
      const today = getTodayKey();
      setDailyState(createDailyState(today));
    } finally {
      setStorageLoaded(true);
    }
  }

  function createDailyState(dateKey) {
    const dailyDigits = getDailyDigits(dateKey);
    const dailyMeta   = analyzeDigits(dailyDigits);
    return {
      dateKey,
      digits: dailyDigits,
      difficulty: dailyMeta.difficulty,
      completedAt: null,
      elapsedSeconds: null,
      shared: false,
      startedAt: null,
    };
  }

  // ── Animations ────────────────────────────────────────────
  function animateSuccess() {
    glow.setValue(0);
    Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 140, useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 380, useNativeDriver: false }),
    ]).start();
  }

  // ── Input handlers ────────────────────────────────────────
  function appendToken(token) {
    setInlineMessage('');
    setExpression((prev) => prev + token);
  }

  function clearExpression() {
    setInlineMessage('');
    setExpression('');
  }

  function deleteLast() {
    setInlineMessage('');
    setExpression((prev) => prev.slice(0, -1));
  }

  // ── Mode navigation ───────────────────────────────────────
  function openRandomPrompt() {
    setInlineMessage('');
    setShowRandomPrompt(true);
  }

  function startRandomWithDifficulty(difficulty) {
    setRandomLoading(true);
    setInlineMessage('');
    setShowRandomPrompt(false);
    setShowRevealedSolution(false);

    setTimeout(() => {
      try {
        const nextDigits = getRandomDigitsForDifficulty(difficulty);
        if (!nextDigits) {
          setRandomLoading(false);
          setInlineMessage('Could not find a puzzle for that mode. Try again.');
          return;
        }
        const nextMeta = analyzeDigits(nextDigits);
        setDigits(nextDigits);
        setExpression('');
        setInlineMessage('');
        setCurrentMeta(nextMeta);
        setSolution(nextMeta.solution);
        setScreen('play-random');
        setRandomLoading(false);
      } catch (e) {
        setRandomLoading(false);
        setInlineMessage('Something went wrong generating that puzzle. Try again.');
      }
    }, 50);
  }

  function loadAnotherFromCurrentMode() {
    setInlineMessage('');
    setExpression('');
    setShowRevealedSolution(false);

    if (screen === 'play-random') {
      const nextDigits = getRandomDigitsForDifficulty(currentMeta.difficulty || selectedRandomDifficulty);
      if (!nextDigits) { setInlineMessage('Could not find another puzzle. Try again.'); return; }
      const nextMeta = analyzeDigits(nextDigits);
      setDigits(nextDigits);
      setCurrentMeta(nextMeta);
      setSolution(nextMeta.solution);
      return;
    }

    if (screen === 'play-live') {
      const nextDigits = getRandomDigitsForDifficulty(currentMeta.difficulty || 'simple');
      if (!nextDigits) { setInlineMessage('Could not find another puzzle. Try again.'); return; }
      const nextMeta = analyzeDigits(nextDigits);
      setDigits(nextDigits);
      setCurrentMeta(nextMeta);
      setSolution(nextMeta.solution);
    }
  }

  async function startDaily() {
    if (!dailyState) {
      setInlineMessage('Still loading — please try again.');
      return;
    }
    setDigits(dailyState.digits);
    setExpression('');
    setInlineMessage('');
    setShowRevealedSolution(false);

    if (dailyState.completedAt) {
      setDailyTimerDateKey(dailyState.dateKey);
      setDailyTimerStartedAt(dailyState.startedAt || null);
      setDailyTimerSeconds(dailyState.elapsedSeconds || 0);
    } else {
      let startedAt = dailyState.startedAt;
      if (!startedAt) {
        startedAt = Date.now();
        const updatedDaily = { ...dailyState, startedAt };
        setDailyState(updatedDaily);
        await AsyncStorage.setItem(STORAGE_DAILY, JSON.stringify(updatedDaily));
      }
      setDailyTimerDateKey(dailyState.dateKey);
      setDailyTimerStartedAt(startedAt);
      setDailyTimerSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }
    setScreen('play-daily');
  }

  function startLiveCommute() {
    setLiveInput('');
    setLivePlayableMessage('');
    setInlineMessage('');
    setShowRevealedSolution(false);
    setShowLivePrompt(true);
  }

  function submitLiveCommute() {
    const cleaned = liveInput.trim();
    if (!/^[0-9]{4}$/.test(cleaned)) {
      setLivePlayableMessage('Enter exactly 4 digits.');
      return;
    }
    const liveMeta = analyzeDigits(cleaned);
    if (liveMeta.solution) {
      setLivePlayableMessage(
        'Playable — ' + titleCase(liveMeta.difficulty) + ' • ' +
        liveMeta.solutionCount + ' ' + (liveMeta.solutionCount === 1 ? 'solution' : 'solutions')
      );
      setDigits(cleaned);
      setExpression('');
      setInlineMessage('');
      setCurrentMeta(liveMeta);
      setSolution(liveMeta.solution);
      setShowRevealedSolution(false);
      setTimeout(() => { setShowLivePrompt(false); setScreen('play-live'); }, 350);
    } else {
      setLivePlayableMessage('Not playable — no valid solution under the current rules.');
    }
  }

  // ── Check answer ──────────────────────────────────────────
  async function check() {
    try {
      if (!expression.trim()) {
        setInlineMessage('Build an expression that equals 10.');
        return;
      }
      if (extractDigits(expression) !== digits) {
        setInlineMessage('Use all four digits in the same order.');
        return;
      }
      const value = evaluate(expression);

      if (Math.abs(value - 10) < 0.000000001) {
        setInlineMessage('');
        animateSuccess();

        const isUnique = !history.some((item) => item.digits === digits);
        if (isUnique) {
          const entry = { id: Date.now().toString(), digits, expression, solvedAt: new Date().toISOString() };
          const updatedHistory = [entry, ...history];
          setHistory(updatedHistory);
          await AsyncStorage.setItem(STORAGE_HISTORY, JSON.stringify(updatedHistory));
        }

        if (screen === 'play-daily' && dailyState && !dailyState.completedAt) {
          const updatedDaily = {
            ...dailyState,
            completedAt: Date.now(),
            elapsedSeconds: dailyTimerSeconds,
            startedAt: dailyState.startedAt || dailyTimerStartedAt,
          };
          setDailyState(updatedDaily);
          await AsyncStorage.setItem(STORAGE_DAILY, JSON.stringify(updatedDaily));

          // Update streak
          const today     = getTodayKey();
          const yesterday = getYesterdayKey();
          const newCount  =
            streak.lastDate === today     ? streak.count :
            streak.lastDate === yesterday ? streak.count + 1 : 1;
          const newStreak = { count: newCount, lastDate: today };
          setStreak(newStreak);
          await AsyncStorage.setItem(STORAGE_STREAK, JSON.stringify(newStreak));

          // Update best time
          if (bestTime === null || dailyTimerSeconds < bestTime) {
            setBestTime(dailyTimerSeconds);
            await AsyncStorage.setItem(STORAGE_BEST, JSON.stringify(dailyTimerSeconds));
          }

          setSuccessModal({
            visible: true,
            title: 'Puzzle Solved! 🚇',
            subtitle:
              'Daily #' + getDailyGameNumber(dailyState.dateKey) +
              '  •  ⏱ ' + formatSeconds(updatedDaily.elapsedSeconds) +
              (newCount > 1 ? '  •  🔥 ' + newCount + ' day streak' : ''),
            showShare: true,
            primaryLabel: 'Back to Home',
            primaryAction: 'home',
          });

        } else if (screen === 'play-random') {
          setSuccessModal({
            visible: true,
            title: 'Correct! 🎉',
            subtitle:
              digits + ' solved  •  ' + titleCase(currentMeta.difficulty) +
              '  •  ' + currentMeta.solutionCount + ' ' +
              (currentMeta.solutionCount === 1 ? 'solution' : 'solutions'),
            showShare: true,
            primaryLabel: 'Next Puzzle →',
            primaryAction: 'next',
          });
        } else if (screen === 'play-live') {
          setSuccessModal({
            visible: true,
            title: 'Correct! 🎉',
            subtitle:
              digits + ' solved  •  ' + titleCase(currentMeta.difficulty) +
              '  •  ' + currentMeta.solutionCount + ' ' +
              (currentMeta.solutionCount === 1 ? 'solution' : 'solutions'),
            showShare: true,
            primaryLabel: 'Next Puzzle →',
            primaryAction: 'next',
          });
        }
      } else {
        setInlineMessage('Not quite — keep going until the result is 10.');
      }
    } catch (e) {
      setInlineMessage('Invalid expression. Try a different combination.');
    }
  }

  async function shareCurrentResult() {
    try {
      if (screen === 'play-daily' && dailyState && dailyState.completedAt) {
        const gameNumber = getDailyGameNumber(dailyState.dateKey);
        const result = [
          'Commuter Game 🚇',
          'Daily #' + gameNumber,
          'Number: ' + dailyState.digits,
          'Mode: ' + titleCase(currentMeta.difficulty),
          'Solutions: ' + currentMeta.solutionCount,
          'Time: ' + formatSeconds(dailyState.elapsedSeconds || 0),
        ].join(NL);
        await Share.share({ message: result });
        const updatedDaily = { ...dailyState, shared: true };
        setDailyState(updatedDaily);
        await AsyncStorage.setItem(STORAGE_DAILY, JSON.stringify(updatedDaily));
        return;
      }
      const modeName = screen === 'play-random' ? 'Random Challenge' : 'Live Commute';
      const result = [
        'Commuter Game 🚇',
        modeName,
        'Number: ' + digits,
        'Mode: ' + titleCase(currentMeta.difficulty),
        'Solutions: ' + currentMeta.solutionCount,
      ].join(NL);
      await Share.share({ message: result });
    } catch (e) {}
  }

  function closeSuccess(primaryAction) {
    setSuccessModal({ visible: false, title: '', subtitle: '', showShare: false, primaryLabel: 'Home', primaryAction: 'home' });
    if (primaryAction === 'home') { setScreen('menu'); return; }
    if (primaryAction === 'next') { loadAnotherFromCurrentMode(); }
  }

  // ── Derived values ────────────────────────────────────────
  const glowColor = glow.interpolate({
    inputRange:  [0, 1],
    outputRange: ['#ffffff', '#d4f5e2'],
  });

  const completion = useMemo(() => ((history.length / TOTAL_SOLVABLE) * 100).toFixed(2), [history.length]);

  const isDailyDone   = !!(dailyState && dailyState.completedAt);
  const dailySubtitle = isDailyDone
    ? 'Completed in ' + formatSeconds(dailyState.elapsedSeconds || 0)
    : 'Timed daily challenge';

  const visibleDailyTime = isDailyDone ? dailyState.elapsedSeconds || 0 : dailyTimerSeconds;

  const modeLabel = screen === 'play-daily' ? 'Daily Challenge'
    : screen === 'play-random' ? 'Random Challenge' : 'Live Commute';
  const modeEmoji = screen === 'play-daily' ? '🚇'
    : screen === 'play-random' ? '🎲' : '🚆';

  // ── Helpers used in render ────────────────────────────────
  function goMenu() { setShowRevealedSolution(false); setScreen('menu'); }

  // ══════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={S.safe}>
      <View style={S.root}>

        {/* ─── MENU ──────────────────────────────────────── */}
        {screen === 'menu' && (
          <ScrollView
            style={S.scroll}
            contentContainerStyle={S.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={[S.col, { width: contentWidth }]}>

              {/* App header */}
              <View style={S.appHeader}>
                <View>
                  <Text style={S.appTitle}>Commuter{'\n'}Game</Text>
                  <View style={S.dotsRow}>
                    {[['1', MTA.red], ['4', MTA.green], ['A', MTA.blue], ['7', MTA.purple]].map(([line, color]) => (
                      <View key={line} style={[S.dot, { backgroundColor: color }]}>
                        <Text style={S.dotText}>{line}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                <TouchableOpacity style={S.howToBtn} onPress={() => setShowHelp(true)}>
                  <Text style={S.howToBtnText}>How to Play</Text>
                </TouchableOpacity>
              </View>

              {/* ── Daily hero card ── */}
              <TouchableOpacity
                style={[S.heroCard, !storageLoaded && S.disabled]}
                onPress={startDaily}
                activeOpacity={0.87}
              >
                {/* Colored top accent */}
                <View style={[S.heroAccentBar, { backgroundColor: MTA.purple }]} />

                <View style={S.heroCardInner}>
                  {/* Header row */}
                  <View style={S.heroTopRow}>
                    <View style={S.heroLabelRow}>
                      <View style={[S.dot, { backgroundColor: MTA.purple, width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[S.dotText, { fontSize: 13 }]}>7</Text>
                      </View>
                      <Text style={[S.heroModeLabel, { color: MTA.purple }]}>DAILY CHALLENGE</Text>
                    </View>
                    {!storageLoaded ? null : isDailyDone ? (
                      <View style={S.doneChip}>
                        <Text style={S.doneChipText}>✓  Done</Text>
                      </View>
                    ) : (
                      <View style={S.todayChip}>
                        <Text style={S.todayChipText}>TODAY</Text>
                      </View>
                    )}
                  </View>

                  {/* Number + subtitle */}
                  {!storageLoaded ? (
                    <ActivityIndicator size="large" color={MTA.purple} style={{ marginVertical: 20 }} />
                  ) : (
                    <>
                      <Text style={S.heroGameNumber}>
                        Daily #{dailyState ? getDailyGameNumber(dailyState.dateKey) : '—'}
                      </Text>
                      <Text style={S.heroSubtitle}>{dailySubtitle}</Text>
                    </>
                  )}

                  {/* Stats strip */}
                  <View style={S.statsStrip}>
                    <View style={S.stat}>
                      <Text style={S.statValue}>🔥 {streak.count}</Text>
                      <Text style={S.statLabel}>Streak</Text>
                    </View>
                    <View style={S.statDivider} />
                    <View style={S.stat}>
                      <Text style={S.statValue}>⏱ {bestTime !== null ? formatSeconds(bestTime) : '—'}</Text>
                      <Text style={S.statLabel}>Best</Text>
                    </View>
                    <View style={S.statDivider} />
                    <View style={S.stat}>
                      <Text style={S.statValue}>🚇 {history.length}</Text>
                      <Text style={S.statLabel}>Solved</Text>
                    </View>
                  </View>

                  {/* CTA button */}
                  <View style={[S.heroCTA, isDailyDone && S.heroCTADone]}>
                    <Text style={S.heroCTAText}>
                      {isDailyDone ? 'View Today\'s Results  →' : 'Play Today\'s Challenge  →'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* ── Two mode cards ── */}
              <View style={S.modeRow}>
                {/* Live Commute */}
                <TouchableOpacity style={[S.modeCard, { borderTopColor: MTA.blue }]} onPress={startLiveCommute} activeOpacity={0.87}>
                  <Text style={S.modeEmoji}>🚆</Text>
                  <View style={[S.dot, { backgroundColor: MTA.blue, width: 24, height: 24, borderRadius: 12, marginBottom: 8 }]}>
                    <Text style={[S.dotText, { fontSize: 10 }]}>A</Text>
                  </View>
                  <Text style={S.modeTitle}>Live{'\n'}Commute</Text>
                  <Text style={S.modeSub}>Enter any number</Text>
                </TouchableOpacity>

                {/* Random Challenge */}
                <TouchableOpacity style={[S.modeCard, { borderTopColor: MTA.green }]} onPress={openRandomPrompt} activeOpacity={0.87}>
                  <Text style={S.modeEmoji}>🎲</Text>
                  <View style={[S.dot, { backgroundColor: MTA.green, width: 24, height: 24, borderRadius: 12, marginBottom: 8 }]}>
                    <Text style={[S.dotText, { fontSize: 10 }]}>4</Text>
                  </View>
                  <Text style={S.modeTitle}>Random{'\n'}Challenge</Text>
                  <Text style={S.modeSub}>Pick difficulty</Text>
                </TouchableOpacity>
              </View>

              <View style={{ height: 8 }} />
            </View>
          </ScrollView>
        )}

        {/* ─── PLAY SCREENS ──────────────────────────────── */}
        {(screen === 'play-daily' || screen === 'play-random' || screen === 'play-live') && (
          <View style={[S.playOuter, { paddingHorizontal: Math.max((screenWidth - contentWidth) / 2, 16) }]}>
            <View style={{ width: contentWidth, flex: 1 }}>

              {/* Play header card — flex:1 so it fills all space above the keypad */}
              <Animated.View style={[S.playCard, { flex: 1, backgroundColor: glowColor }]}>

                {/* Top nav row */}
                <View style={S.playTopRow}>
                  <View style={S.playTitleGroup}>
                    <Text style={S.playModeEmoji}>{modeEmoji}</Text>
                    <View>
                      <Text style={S.playTitle}>Commuter Game</Text>
                      <Text style={S.playMode}>{modeLabel}</Text>
                    </View>
                  </View>
                  <View style={S.playNavGroup}>
                    <TouchableOpacity style={S.navBtn} onPress={goMenu}>
                      <Text style={S.navBtnText}>← Home</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={S.infoBtn} onPress={() => setShowHelp(true)}>
                      <Text style={S.infoBtnText}>?</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Current number label + timer */}
                <View style={S.trainLabelRow}>
                  <Text style={S.trainLabel}>CURRENT NUMBER</Text>
                  {screen === 'play-daily' && (
                    <View style={[S.timerPill, isDailyDone && S.timerPillDone]}>
                      <Text style={[S.timerText, isDailyDone && S.timerTextDone]}>
                        ⏱  {formatSeconds(visibleDailyTime)}
                      </Text>
                    </View>
                  )}
                </View>

                {/* ── Subway sign panel ── */}
                <View style={S.signPanel}>
                  <Text style={S.signDigits}>{digits}</Text>
                  <Text style={S.signRule}>
                    Use digits in order · make an expression equal to 10
                  </Text>
                  <View style={S.signMetaRow}>
                    <View style={difficultyPillStyle(currentMeta.difficulty)}>
                      <Text style={S.pillText}>{titleCase(currentMeta.difficulty)}</Text>
                    </View>
                    <View style={S.countPill}>
                      <Text style={S.countPillText}>
                        {currentMeta.solutionCount}{' '}
                        {currentMeta.solutionCount === 1 ? 'solution' : 'solutions'}
                      </Text>
                    </View>
                  </View>

                  {/* Show / hide solution (live + random only) */}
                  {(screen === 'play-live' || screen === 'play-random') && !!solution && (
                    <>
                      <TouchableOpacity
                        style={S.revealBtn}
                        onPress={() => setShowRevealedSolution((p) => !p)}
                      >
                        <Text style={S.revealBtnText}>
                          {showRevealedSolution ? 'Hide Solution  ▲' : 'Show Solution  ▼'}
                        </Text>
                      </TouchableOpacity>

                      {showRevealedSolution && (
                        <>
                          <View style={S.revealBox}>
                            <Text style={S.revealBoxLabel}>SOLUTION</Text>
                            <Text style={S.revealBoxExpr}>{solution} = 10</Text>
                          </View>
                          <TouchableOpacity style={S.nextTrainBtn} onPress={loadAnotherFromCurrentMode}>
                            <Text style={S.nextTrainBtnText}>Next Puzzle  →</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </>
                  )}
                </View>

                {/* Flexible spacer pushes expression + status to the bottom of the card */}
                <View style={{ flex: 1 }} />

                {/* Expression display */}
                <View style={S.exprBox}>
                  <Text style={S.exprText} numberOfLines={1}>
                    {expression || 'Tap digits and operators below…'}
                  </Text>
                </View>

                {/* Inline status */}
                {!!inlineMessage && (
                  <View style={S.statusBox}>
                    <Text style={S.statusText}>{inlineMessage}</Text>
                  </View>
                )}

                {/* Solved badge */}
                {screen === 'play-daily' && isDailyDone && (
                  <View style={S.solvedBadge}>
                    <Text style={S.solvedBadgeText}>✓  SOLVED</Text>
                  </View>
                )}
              </Animated.View>

              {/* ── Keypad ── */}
              <View style={S.keypad}>
                <Text style={S.keypadLabel}>DIGITS</Text>
                <View style={S.digitsRow}>
                  {digits.split('').map((d, i) => (
                    <TouchableOpacity key={i} style={S.digitKey} onPress={() => appendToken(d)} activeOpacity={0.72}>
                      <Text style={S.digitKeyText}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={S.keypadLabel}>OPERATORS</Text>
                <View style={S.opsRow}>
                  {OPERATORS.map((tok) => (
                    <TouchableOpacity key={tok} style={S.opKey} onPress={() => appendToken(tok)} activeOpacity={0.72}>
                      <Text style={S.opKeyText}>{tok}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={S.keypadActions}>
                  <TouchableOpacity style={S.clearBtn} onPress={clearExpression} activeOpacity={0.8}>
                    <Text style={S.clearBtnText}>Clear</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.deleteBtn} onPress={deleteLast} activeOpacity={0.8}>
                    <Text style={S.deleteBtnText}>⌫</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.checkBtn} onPress={check} activeOpacity={0.8}>
                    <Text style={S.checkBtnText}>Check  ✓</Text>
                  </TouchableOpacity>
                </View>
              </View>

            </View>
          </View>
        )}

        {/* ─── LIBRARY ───────────────────────────────────── */}
        {screen === 'library' && (
          <>
            <View style={[S.libHeader, { alignSelf: 'center', width: contentWidth }]}>
              <Text style={S.libTitle}>Library</Text>
              <Text style={S.libSub}>Your solved trains</Text>
            </View>

            <View style={[S.libStatsRow, { alignSelf: 'center', width: contentWidth }]}>
              <View style={S.libStatCard}>
                <Text style={S.libStatValue}>{history.length}</Text>
                <Text style={S.libStatLabel}>Solved</Text>
              </View>
              <View style={S.libStatCard}>
                <Text style={S.libStatValue}>{completion}%</Text>
                <Text style={S.libStatLabel}>Complete</Text>
              </View>
              <View style={S.libStatCard}>
                <Text style={S.libStatValue}>🔥 {streak.count}</Text>
                <Text style={S.libStatLabel}>Streak</Text>
              </View>
            </View>

            <Text style={[S.libHelper, { alignSelf: 'center', width: contentWidth }]}>
              Completion = % of all {TOTAL_SOLVABLE.toLocaleString()} solvable 4-digit combos
            </Text>

            <ScrollView style={S.scroll} contentContainerStyle={{ alignItems: 'center', paddingBottom: 16 }}>
              {history.length === 0 && (
                <Text style={S.emptyText}>
                  Nothing solved yet.{'\n'}Play Daily Challenge or Random to get started!
                </Text>
              )}
              {history.map((item) => {
                const m = analyzeDigits(item.digits);
                return (
                  <View key={item.id} style={[S.historyCard, { width: contentWidth }]}>
                    <View style={S.historyCardTop}>
                      <Text style={S.historyDigits}>{item.digits}</Text>
                      <View style={difficultyPillStyle(m.difficulty)}>
                        <Text style={S.pillText}>{titleCase(m.difficulty)}</Text>
                      </View>
                    </View>
                    <Text style={S.historyExpr}>{item.expression} = 10</Text>
                    <Text style={S.historySols}>
                      {m.solutionCount} {m.solutionCount === 1 ? 'solution' : 'solutions'}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* ─── TAB BAR ───────────────────────────────────── */}
        <View style={[S.tabBar, { alignSelf: 'center', width: contentWidth }]}>
          <TouchableOpacity style={[S.tab, screen !== 'library' && S.tabActive]} onPress={goMenu}>
            <Text style={S.tabEmoji}>🚇</Text>
            <Text style={[S.tabText, screen !== 'library' && S.tabTextActive]}>Play</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.tab, screen === 'library' && S.tabActive]}
            onPress={() => { setShowRevealedSolution(false); setScreen('library'); }}
          >
            <Text style={S.tabEmoji}>📚</Text>
            <Text style={[S.tabText, screen === 'library' && S.tabTextActive]}>Library</Text>
          </TouchableOpacity>
        </View>

        {/* ══ MODALS ══════════════════════════════════════ */}

        {/* How to Play */}
        <Modal visible={showHelp} transparent animationType="slide" onRequestClose={() => setShowHelp(false)}>
          <View style={S.backdrop}>
            <View style={[S.modalCard, { width: contentWidth }]}>
              {/* Header row with close X */}
              <View style={S.helpModalHeader}>
                <View>
                  <Text style={S.modalTitle}>How to Play</Text>
                  <Text style={S.modalSub}>Simple rules. Fast solve.</Text>
                </View>
                <TouchableOpacity style={S.helpCloseBtn} onPress={() => setShowHelp(false)}>
                  <Text style={S.helpCloseBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={S.modalScroll} showsVerticalScrollIndicator={false}>
                <Text style={S.modalBody}>
                  {[
                    'Inspired by spotting a 4-digit car number on the train, subway, or bus.',
                    'Use all four digits in the same order they appear.',
                    'Create a math expression that equals 10.',
                    'Allowed operators:\n+  −  ×  ÷  ^  ( )',
                    'You can combine neighboring digits to make larger numbers like 23 or 68.',
                  ].join('\n\n')}
                </Text>
                <View style={S.helpExample}>
                  <Text style={S.helpExampleLabel}>EXAMPLE</Text>
                  <Text style={S.helpExampleDigits}>2368</Text>
                  <Text style={S.helpExampleExpr}>(2 × (3 + 6)) − 8 = 10</Text>
                </View>
                <View style={{ height: 8 }} />
              </ScrollView>
              {/* Green pill CTA — distinct from dark modal buttons elsewhere */}
              <TouchableOpacity style={S.helpDoneBtn} onPress={() => setShowHelp(false)}>
                <Text style={S.helpDoneBtnText}>Got it  ✓</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Live Commute */}
        <Modal visible={showLivePrompt} transparent animationType="fade" onRequestClose={() => setShowLivePrompt(false)}>
          <View style={S.backdrop}>
            <View style={[S.modalCard, { width: contentWidth }]}>
              <View style={S.modalBadgeRow}>
                <View style={[S.dot, { backgroundColor: MTA.blue, width: 36, height: 36, borderRadius: 18 }]}>
                  <Text style={[S.dotText, { fontSize: 16 }]}>A</Text>
                </View>
                <Text style={S.modalTitle}>Live Commute</Text>
              </View>
              <Text style={S.modalSub}>
                Enter the 4-digit number you spotted — see if it can make 10.
              </Text>
              <TextInput
                value={liveInput}
                onChangeText={setLiveInput}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="2368"
                placeholderTextColor="#bbb"
                style={S.liveInput}
              />
              {!!livePlayableMessage && <Text style={S.liveMsg}>{livePlayableMessage}</Text>}
              <View style={S.modalBtnRow}>
                <TouchableOpacity style={S.modalSecBtn} onPress={() => setShowLivePrompt(false)}>
                  <Text style={S.modalSecBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.modalPrimaryBtn} onPress={submitLiveCommute}>
                  <Text style={S.modalPrimaryBtnText}>Check  →</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Random Challenge */}
        <Modal
          visible={showRandomPrompt}
          transparent
          animationType="fade"
          onRequestClose={() => { if (!randomLoading) setShowRandomPrompt(false); }}
        >
          <View style={S.backdrop}>
            <View style={[S.modalCard, { width: contentWidth }]}>
              <View style={S.modalBadgeRow}>
                <View style={[S.dot, { backgroundColor: MTA.green, width: 36, height: 36, borderRadius: 18 }]}>
                  <Text style={[S.dotText, { fontSize: 16 }]}>4</Text>
                </View>
                <Text style={S.modalTitle}>Random Challenge</Text>
              </View>
              <Text style={S.modalSub}>Choose a difficulty and get a solvable number.</Text>

              <View style={S.diffRow}>
                {['simple', 'complex'].map((lvl) => (
                  <TouchableOpacity
                    key={lvl}
                    style={[S.diffBtn, selectedRandomDifficulty === lvl && S.diffBtnActive]}
                    onPress={() => !randomLoading && setSelectedRandomDifficulty(lvl)}
                    disabled={randomLoading}
                  >
                    <Text style={[S.diffBtnText, selectedRandomDifficulty === lvl && S.diffBtnTextActive]}>
                      {lvl === 'simple' ? '🟢  Simple' : '🔴  Complex'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {randomLoading && (
                <View style={S.loadingRow}>
                  <ActivityIndicator size="small" color="#0f1923" />
                  <Text style={S.loadingText}>Finding your train…</Text>
                </View>
              )}

              <View style={S.modalBtnRow}>
                <TouchableOpacity
                  style={[S.modalSecBtn, randomLoading && S.btnOff]}
                  onPress={() => setShowRandomPrompt(false)}
                  disabled={randomLoading}
                >
                  <Text style={S.modalSecBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.modalPrimaryBtn, randomLoading && S.btnOff]}
                  onPress={() => startRandomWithDifficulty(selectedRandomDifficulty)}
                  disabled={randomLoading}
                >
                  <Text style={S.modalPrimaryBtnText}>Start  →</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Success */}
        <Modal
          visible={successModal.visible}
          transparent
          animationType="fade"
          onRequestClose={() => closeSuccess(successModal.primaryAction)}
        >
          <View style={S.backdrop}>
            <View style={[S.successCard, { width: contentWidth }]}>
              <Text style={S.successEmoji}>
                {screen === 'play-daily' ? '🏆' : '🎉'}
              </Text>
              <Text style={S.successTitle}>{successModal.title}</Text>
              <Text style={S.successSub}>{successModal.subtitle}</Text>
              <View style={S.modalBtnRow}>
                {successModal.showShare && (
                  <TouchableOpacity style={S.modalSecBtn} onPress={shareCurrentResult}>
                    <Text style={S.modalSecBtnText}>Share  📤</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={S.modalPrimaryBtn}
                  onPress={() => closeSuccess(successModal.primaryAction)}
                >
                  <Text style={S.modalPrimaryBtnText}>{successModal.primaryLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

// ══ Pure game-logic functions (unchanged) ════════════════════

function emptyMeta() {
  return { solution: null, solutionCount: 0, difficulty: 'simple' };
}

function evaluate(expr) {
  return Function('"use strict"; return (' + expr.replace(/\^/g, '**') + ')')();
}

function extractDigits(expr) {
  return String(expr || '').replace(/[^0-9]/g, '');
}

function analyzeDigits(digits) {
  if (ANALYSIS_CACHE.has(digits)) return ANALYSIS_CACHE.get(digits);

  const partitions = [];
  function partition(index, parts) {
    if (index === digits.length) { partitions.push(parts.slice()); return; }
    for (let end = index + 1; end <= digits.length; end += 1) {
      parts.push(digits.slice(index, end));
      partition(end, parts);
      parts.pop();
    }
  }
  partition(0, []);

  const exactSolutions = new Set();
  let firstSolution = null;
  let easiestScore  = Infinity;

  for (let i = 0; i < partitions.length; i += 1) {
    const built = buildExpressions(partitions[i]);
    for (let j = 0; j < built.length; j += 1) {
      const item = built[j];
      if (Math.abs(item.value - 10) < 0.000000001) {
        exactSolutions.add(item.expr);
        if (!firstSolution) firstSolution = item.expr;
        const score = scoreExpression(item.expr);
        if (score < easiestScore) easiestScore = score;
      }
    }
  }

  const solutionCount = exactSolutions.size;
  const difficulty    = classifyDifficulty(solutionCount, easiestScore);
  const result        = { solution: firstSolution, solutionCount, difficulty };
  ANALYSIS_CACHE.set(digits, result);
  return result;
}

function buildExpressions(parts) {
  const cacheKey = parts.join('|');
  if (EXPRESSION_CACHE.has(cacheKey)) return EXPRESSION_CACHE.get(cacheKey);

  if (parts.length === 1) {
    const single = [{ expr: parts[0], value: Number(parts[0]) }];
    EXPRESSION_CACHE.set(cacheKey, single);
    return single;
  }

  const out = [];
  for (let split = 1; split < parts.length; split += 1) {
    const left  = buildExpressions(parts.slice(0, split));
    const right = buildExpressions(parts.slice(split));
    for (let i = 0; i < left.length; i += 1) {
      for (let j = 0; j < right.length; j += 1) {
        out.push({ expr: '(' + left[i].expr + '+' + right[j].expr + ')', value: left[i].value + right[j].value });
        out.push({ expr: '(' + left[i].expr + '-' + right[j].expr + ')', value: left[i].value - right[j].value });
        out.push({ expr: '(' + left[i].expr + '*' + right[j].expr + ')', value: left[i].value * right[j].value });
        if (Math.abs(right[j].value) > 0.000000001) {
          out.push({ expr: '(' + left[i].expr + '/' + right[j].expr + ')', value: left[i].value / right[j].value });
        }
        if (
          Number.isInteger(left[i].value) &&
          Number.isInteger(right[j].value) &&
          right[j].value >= 0 &&
          right[j].value <= 6
        ) {
          const powerValue = Math.pow(left[i].value, right[j].value);
          if (Number.isFinite(powerValue) && Math.abs(powerValue) < 1000000) {
            out.push({ expr: '(' + left[i].expr + '^' + right[j].expr + ')', value: powerValue });
          }
        }
      }
    }
  }
  EXPRESSION_CACHE.set(cacheKey, out);
  return out;
}

function scoreExpression(expr) {
  const operatorMatches  = expr.match(/[+\-*/^]/g) || [];
  const hasPower         = expr.indexOf('^') >= 0;
  const parenCount       = (expr.match(/[()]/g) || []).length;
  const multiDigitGroups = expr.match(/[0-9]{2,}/g) || [];
  let score = operatorMatches.length * 0.8;
  score += Math.floor(parenCount / 2) * 0.3;
  score += multiDigitGroups.length * 0.65;
  if (hasPower) score += 1.1;
  return score;
}

function classifyDifficulty(solutionCount, easiestScore) {
  if (solutionCount === 0) return 'complex';
  if (solutionCount >= 2 && easiestScore <= 5.2) return 'simple';
  return 'complex';
}

function getRandomDigitsForDifficulty(level) {
  for (let tries = 0; tries < 400; tries += 1) {
    const candidate = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const meta = analyzeDigits(candidate);
    if (!meta.solution) continue;
    if (meta.difficulty === level) return candidate;
  }
  for (let i = 0; i < 10000; i += 1) {
    const candidate = String(i).padStart(4, '0');
    const meta = analyzeDigits(candidate);
    if (meta.solution && meta.difficulty === level) return candidate;
  }
  return null;
}

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function getYesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function getDailyDigits(dateKey) {
  let seed = 0;
  for (let i = 0; i < dateKey.length; i += 1) {
    seed = (seed * 31 + dateKey.charCodeAt(i)) % 2147483647;
  }
  for (let offset = 0; offset < 10000; offset += 1) {
    const candidate = String((seed + offset) % 10000).padStart(4, '0');
    const meta = analyzeDigits(candidate);
    if (meta.solution) return candidate;
  }
  return '2368';
}

function getDailyGameNumber(dateKey) {
  const start   = new Date(DAILY_GAME_EPOCH + 'T00:00:00');
  const current = new Date(dateKey + 'T00:00:00');
  return Math.floor((current.getTime() - start.getTime()) / 86400000) + 1;
}

function formatSeconds(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function difficultyPillStyle(level) {
  return [S.pill, level === 'simple' ? S.pillSimple : S.pillComplex];
}

// ══ Styles ════════════════════════════════════════════════════
//
//  Design tokens
//  BG      #faf8f4   warm cream
//  CARD    #ffffff   white
//  CARD2   #f5f2ed   warm off-white
//  BORDER  #e8e2d8   warm light gray
//  NAVY    #0f1923   primary text / dark keys
//  MED     #4a5568   secondary text
//  MUTED   #9aa0b0   labels / placeholders
//
//  MTA exact (never modified — see MTA constant above):
//  red #ee352e  green #00933c  blue #2850ad
//  purple #b933ad  yellow #fccc0a
//
const S = StyleSheet.create({

  // ── Shell ────────────────────────────────────────────────
  safe: { flex: 1, backgroundColor: '#faf8f4' },
  root: {
    flex: 1,
    backgroundColor: '#faf8f4',
    paddingTop:    Platform.OS === 'android' ? 12 : 0,
    paddingBottom: 12,
  },

  scroll:        { flex: 1 },
  scrollContent: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  col:           { /* width set inline */ },

  // Play screen uses a non-scrolling flex container so everything fits on screen
  playOuter: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },

  // ── App header ───────────────────────────────────────────
  appHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    marginTop: 8,
  },
  appTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0f1923',
    letterSpacing: -0.5,
    lineHeight: 36,
    marginBottom: 10,
  },
  dotsRow:  { flexDirection: 'row', gap: 7 },
  dot:      { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dotText:  { color: '#fff', fontSize: 12, fontWeight: '900' },

  howToBtn: {
    backgroundColor: '#0f1923',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  howToBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // ── Daily hero card ──────────────────────────────────────
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    shadowColor: '#0f1923',
    shadowOpacity: 0.10,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 18,
    elevation: 6,
  },
  heroAccentBar: { height: 6 },
  heroCardInner: { padding: 20 },
  disabled:      { opacity: 0.6 },

  heroTopRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  heroLabelRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroModeLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },

  doneChip: {
    backgroundColor: '#d4f5e2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  doneChipText: { color: '#00933c', fontSize: 12, fontWeight: '900' },

  todayChip: {
    backgroundColor: '#fff4c2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: '#fccc0a',
  },
  todayChipText: { color: '#7a5a00', fontSize: 11, fontWeight: '900', letterSpacing: 1 },

  heroGameNumber: {
    fontSize: 38,
    fontWeight: '900',
    color: '#0f1923',
    letterSpacing: -0.5,
    marginBottom: 5,
  },
  heroSubtitle: { fontSize: 15, color: '#4a5568', fontWeight: '600', marginBottom: 20 },

  statsStrip: {
    flexDirection: 'row',
    backgroundColor: '#f5f2ed',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 18,
    alignItems: 'center',
  },
  stat:         { flex: 1, alignItems: 'center' },
  statValue:    { fontSize: 15, fontWeight: '900', color: '#0f1923', marginBottom: 3 },
  statLabel:    { fontSize: 10, color: '#9aa0b0', fontWeight: '700', letterSpacing: 0.5 },
  statDivider:  { width: 1, height: 30, backgroundColor: '#e8e2d8' },

  heroCTA: {
    backgroundColor: '#b933ad',
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: '#b933ad',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  heroCTADone: { backgroundColor: '#00933c', shadowColor: '#00933c' },
  heroCTAText: { color: '#fff', fontSize: 16, fontWeight: '900' },

  // ── Mode cards ───────────────────────────────────────────
  modeRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  modeCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    borderTopWidth: 4,
    alignItems: 'flex-start',
    shadowColor: '#0f1923',
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3,
  },
  modeEmoji: { fontSize: 30, marginBottom: 10 },
  modeTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f1923',
    marginBottom: 5,
    lineHeight: 22,
  },
  modeSub: { fontSize: 12, color: '#9aa0b0', fontWeight: '600' },

  // ── Play header card ─────────────────────────────────────
  playCard: {
    borderRadius: 26,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    shadowColor: '#0f1923',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },
  playTopRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  playTitleGroup:{ flexDirection: 'row', alignItems: 'center', gap: 10 },
  playModeEmoji: { fontSize: 28 },
  playTitle:     { fontSize: 17, fontWeight: '900', color: '#0f1923' },
  playMode:      { fontSize: 11, color: '#9aa0b0', fontWeight: '700', marginTop: 2 },
  playNavGroup:  { flexDirection: 'row', gap: 8 },

  navBtn: {
    backgroundColor: '#f5f2ed',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
  },
  navBtnText: { color: '#0f1923', fontSize: 12, fontWeight: '800' },

  infoBtn: {
    backgroundColor: '#0f1923',
    borderRadius: 999,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },

  trainLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  trainLabel: { fontSize: 10, fontWeight: '900', color: '#9aa0b0', letterSpacing: 2.5 },

  timerPill: {
    backgroundColor: '#fff4c2',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: '#fccc0a',
  },
  timerPillDone: { backgroundColor: '#d4f5e2', borderColor: '#00933c' },
  timerText:     { fontSize: 13, fontWeight: '900', color: '#7a5a00' },
  timerTextDone: { color: '#00933c' },

  // ── Subway sign panel ────────────────────────────────────
  signPanel: {
    backgroundColor: '#0f1923',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 0,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 7,
  },
  signDigits: {
    fontSize: 48,
    fontWeight: '900',
    color: '#f2f6fb',
    letterSpacing: 8,
    marginBottom: 6,
  },
  signRule: {
    fontSize: 11,
    color: '#7a8fa8',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  signMetaRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 0,
  },

  // difficulty pills
  pill:        { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  pillSimple:  { backgroundColor: '#00933c' },
  pillComplex: { backgroundColor: '#ee352e' },
  pillText:    { color: '#fff', fontSize: 11, fontWeight: '900' },

  countPill: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  countPillText: { color: '#c8d8ee', fontSize: 11, fontWeight: '800' },

  revealBtn: {
    marginTop: 14,
    backgroundColor: '#2850ad',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  revealBtnText: { color: '#fff', fontSize: 12, fontWeight: '900' },

  revealBox: {
    width: '100%',
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  revealBoxLabel: { color: '#7a8fa8', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 5, textAlign: 'center' },
  revealBoxExpr:  { color: '#fccc0a', fontSize: 18, fontWeight: '900', textAlign: 'center' },

  nextTrainBtn: {
    marginTop: 12,
    backgroundColor: '#00933c',
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    width: '100%',
  },
  nextTrainBtnText: { color: '#fff', fontSize: 14, fontWeight: '900' },

  // ── Expression + status ──────────────────────────────────
  exprBox: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginBottom: 6,
    borderWidth: 2,
    borderColor: '#e8e2d8',
    minHeight: 48,
    justifyContent: 'center',
  },
  exprText: { color: '#0f1923', fontSize: 18, fontWeight: '800' },

  statusBox: {
    backgroundColor: '#fff4c2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 6,
    borderWidth: 1.5,
    borderColor: '#fccc0a',
  },
  statusText: { color: '#7a5a00', fontSize: 13, fontWeight: '800' },

  solvedBadge: {
    alignSelf: 'center',
    backgroundColor: '#00933c',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginTop: 8,
    shadowColor: '#00933c',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 3,
  },
  solvedBadgeText: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },

  // ── Keypad ───────────────────────────────────────────────
  keypad: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    marginBottom: 0,
    shadowColor: '#0f1923',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 3,
  },
  keypadLabel: {
    color: '#9aa0b0',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.5,
    marginBottom: 7,
  },
  digitsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  digitKey: {
    flex: 1,
    backgroundColor: '#0f1923',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 4,
  },
  digitKeyText: { color: '#ffffff', fontSize: 22, fontWeight: '900' },

  opsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 10,
  },
  opKey: {
    minWidth: '20%',
    flexGrow: 1,
    backgroundColor: '#f5f2ed',
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
  },
  opKeyText: { color: '#0f1923', fontSize: 17, fontWeight: '900' },

  keypadActions: { flexDirection: 'row', gap: 8 },
  clearBtn: {
    flex: 1,
    backgroundColor: '#fff0ef',
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#ffd6d4',
  },
  clearBtnText: { color: '#ee352e', fontSize: 14, fontWeight: '900' },

  deleteBtn: {
    flex: 1,
    backgroundColor: '#f5f2ed',
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
  },
  deleteBtnText: { color: '#0f1923', fontSize: 18, fontWeight: '900' },

  checkBtn: {
    flex: 2,
    backgroundColor: '#00933c',
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    shadowColor: '#00933c',
    shadowOpacity: 0.40,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 5,
  },
  checkBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },

  // ── Library ──────────────────────────────────────────────
  libHeader:    { paddingTop: 8, paddingBottom: 12 },
  libTitle:     { fontSize: 30, fontWeight: '900', color: '#0f1923' },
  libSub:       { fontSize: 14, color: '#9aa0b0', fontWeight: '600', marginTop: 3 },
  libStatsRow:  { flexDirection: 'row', gap: 10, marginBottom: 8 },
  libStatCard:  {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    alignItems: 'center',
    shadowColor: '#0f1923',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  libStatValue: { fontSize: 22, fontWeight: '900', color: '#0f1923', marginBottom: 4 },
  libStatLabel: { fontSize: 11, color: '#9aa0b0', fontWeight: '700' },
  libHelper:    { fontSize: 12, color: '#9aa0b0', marginBottom: 10 },

  historyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    marginBottom: 10,
    shadowColor: '#0f1923',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 1,
  },
  historyCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  historyDigits:  { fontSize: 26, fontWeight: '900', color: '#0f1923' },
  historyExpr:    { fontSize: 15, color: '#4a5568', fontWeight: '700', marginBottom: 4 },
  historySols:    { fontSize: 12, color: '#9aa0b0', fontWeight: '600' },
  emptyText:      { color: '#9aa0b0', fontSize: 15, textAlign: 'center', lineHeight: 26, marginTop: 48 },

  // ── Tab bar ──────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 6,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    marginTop: 6,
    marginBottom: 0,
    shadowColor: '#0f1923',
    shadowOpacity: 0.09,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 4,
  },
  tab:          { flex: 1, borderRadius: 18, paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  tabActive:    { backgroundColor: '#0f1923' },
  tabEmoji:     { fontSize: 16 },
  tabText:      { fontSize: 14, fontWeight: '900', color: '#9aa0b0' },
  tabTextActive:{ color: '#ffffff' },

  // ── Modals ───────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,25,35,0.58)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    padding: 22,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 28,
    elevation: 14,
    maxHeight: '86%',
  },
  modalBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  modalTitle:    { fontSize: 26, fontWeight: '900', color: '#0f1923' },
  modalSub:      { fontSize: 14, color: '#4a5568', lineHeight: 20, marginBottom: 18 },
  modalScroll:   { maxHeight: 320 },
  modalBody:     { fontSize: 15, color: '#4a5568', lineHeight: 25 },

  helpExample: {
    backgroundColor: '#f5f2ed',
    borderRadius: 20,
    padding: 18,
    marginTop: 16,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
  },
  helpExampleLabel:  { fontSize: 10, fontWeight: '900', color: '#9aa0b0', letterSpacing: 2, marginBottom: 8 },
  helpExampleDigits: { fontSize: 44, fontWeight: '900', color: '#0f1923', letterSpacing: 8, marginBottom: 8 },
  helpExampleExpr:   { fontSize: 18, fontWeight: '900', color: '#00933c', lineHeight: 26 },

  modalBtnRow:       { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalPrimaryBtn: {
    flex: 1,
    backgroundColor: '#0f1923',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalPrimaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  modalSecBtn: {
    flex: 1,
    backgroundColor: '#f5f2ed',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
  },
  modalSecBtnText: { color: '#0f1923', fontSize: 16, fontWeight: '900' },

  liveInput: {
    backgroundColor: '#f5f2ed',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e8e2d8',
    color: '#0f1923',
    fontSize: 26,
    fontWeight: '900',
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 10,
    letterSpacing: 8,
    textAlign: 'center',
  },
  liveMsg: { color: '#4a5568', fontSize: 14, fontWeight: '700', marginBottom: 14, textAlign: 'center' },

  diffRow:          { flexDirection: 'row', gap: 10, marginBottom: 18 },
  diffBtn: {
    flex: 1,
    backgroundColor: '#f5f2ed',
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
  },
  diffBtnActive:    { backgroundColor: '#0f1923', borderColor: '#0f1923' },
  diffBtnText:      { color: '#4a5568', fontSize: 14, fontWeight: '800' },
  diffBtnTextActive:{ color: '#ffffff' },

  loadingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14, justifyContent: 'center' },
  loadingText: { color: '#4a5568', fontSize: 14, fontWeight: '700' },
  btnOff:      { opacity: 0.45 },

  // ── How to Play modal extras ─────────────────────────────
  helpModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  helpCloseBtn: {
    backgroundColor: '#f5f2ed',
    borderRadius: 999,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    marginTop: 2,
  },
  helpCloseBtnText: { color: '#0f1923', fontSize: 14, fontWeight: '900' },
  helpDoneBtn: {
    backgroundColor: '#00933c',
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#00933c',
    shadowOpacity: 0.30,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  helpDoneBtnText: { color: '#ffffff', fontSize: 17, fontWeight: '900' },

  // ── Success card ─────────────────────────────────────────
  successCard: {
    backgroundColor: '#ffffff',
    borderRadius: 30,
    padding: 28,
    borderWidth: 1.5,
    borderColor: '#e8e2d8',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 28,
    elevation: 14,
    alignItems: 'center',
  },
  successEmoji:  { fontSize: 64, marginBottom: 14 },
  successTitle:  { fontSize: 30, fontWeight: '900', color: '#0f1923', marginBottom: 8, textAlign: 'center' },
  successSub: {
    fontSize: 15,
    color: '#4a5568',
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
});
