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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OPERATORS = ['(', ')', '^', '+', '-', '*', '/'];
const STORAGE_HISTORY = 'commuter_history_final_v16';
const STORAGE_DAILY = 'commuter_daily_final_v16';
const TOTAL_SOLVABLE = 7437;
const DAILY_GAME_EPOCH = '2025-01-01';
const NL = String.fromCharCode(10);

const ANALYSIS_CACHE = new Map();
const EXPRESSION_CACHE = new Map();

export default function App() {
  const [screen, setScreen] = useState('menu');
  const [digits, setDigits] = useState('2368');
  const [expression, setExpression] = useState('');
  const [solution, setSolution] = useState(null);
  const [history, setHistory] = useState([]);
  const [dailyState, setDailyState] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showLivePrompt, setShowLivePrompt] = useState(false);
  const [showRandomPrompt, setShowRandomPrompt] = useState(false);
  const [liveInput, setLiveInput] = useState('');
  const [livePlayableMessage, setLivePlayableMessage] = useState('');
  const [inlineMessage, setInlineMessage] = useState('');
  const [currentMeta, setCurrentMeta] = useState(emptyMeta());
  const [selectedRandomDifficulty, setSelectedRandomDifficulty] = useState('simple');
  const [randomLoading, setRandomLoading] = useState(false);
  const [showRevealedSolution, setShowRevealedSolution] = useState(false);
  const [successModal, setSuccessModal] = useState({
    visible: false,
    title: '',
    subtitle: '',
    showShare: false,
    primaryLabel: 'Home',
    primaryAction: 'home',
  });
  const [dailyTimerSeconds, setDailyTimerSeconds] = useState(0);
  const [dailyTimerStartedAt, setDailyTimerStartedAt] = useState(null);
  const [dailyTimerDateKey, setDailyTimerDateKey] = useState(null);
  const [storageLoaded, setStorageLoaded] = useState(false);

  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadStored();
  }, []);

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

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [screen, dailyTimerStartedAt, dailyState, dailyTimerDateKey]);

  async function loadStored() {
    try {
      const historyRaw = await AsyncStorage.getItem(STORAGE_HISTORY);
      const dailyRaw = await AsyncStorage.getItem(STORAGE_DAILY);

      if (historyRaw) setHistory(JSON.parse(historyRaw));

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
    const dailyMeta = analyzeDigits(dailyDigits);

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

  function animateSuccess() {
    glow.setValue(0);
    Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 140, useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 380, useNativeDriver: false }),
    ]).start();
  }

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

      if (!nextDigits) {
        setInlineMessage('Could not find another puzzle. Try again.');
        return;
      }

      const nextMeta = analyzeDigits(nextDigits);
      setDigits(nextDigits);
      setCurrentMeta(nextMeta);
      setSolution(nextMeta.solution);
      return;
    }

    if (screen === 'play-live') {
      const nextDigits = getRandomDigitsForDifficulty(currentMeta.difficulty || 'simple');

      if (!nextDigits) {
        setInlineMessage('Could not find another puzzle. Try again.');
        return;
      }

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
        'Playable — ' +
          titleCase(liveMeta.difficulty) +
          ' • ' +
          liveMeta.solutionCount +
          ' ' +
          (liveMeta.solutionCount === 1 ? 'solution' : 'solutions')
      );

      setDigits(cleaned);
      setExpression('');
      setInlineMessage('');
      setCurrentMeta(liveMeta);
      setSolution(liveMeta.solution);
      setShowRevealedSolution(false);

      setTimeout(() => {
        setShowLivePrompt(false);
        setScreen('play-live');
      }, 350);
    } else {
      setLivePlayableMessage('Not playable — no valid solution under the current rules.');
    }
  }

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
          const entry = {
            id: Date.now().toString(),
            digits,
            expression,
            solvedAt: new Date().toISOString(),
          };
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
          setSuccessModal({
            visible: true,
            title: 'Nice work',
            subtitle: 'Solved in ' + formatSeconds(updatedDaily.elapsedSeconds),
            showShare: true,
            primaryLabel: 'Home',
            primaryAction: 'home',
          });
        } else if (screen === 'play-random') {
          setSuccessModal({
            visible: true,
            title: 'Correct',
            subtitle:
              digits +
              ' solved • ' +
              titleCase(currentMeta.difficulty) +
              ' • ' +
              currentMeta.solutionCount +
              ' ' +
              (currentMeta.solutionCount === 1 ? 'solution' : 'solutions'),
            showShare: true,
            primaryLabel: 'New Number',
            primaryAction: 'next',
          });
        } else if (screen === 'play-live') {
          setSuccessModal({
            visible: true,
            title: 'Correct',
            subtitle:
              digits +
              ' solved • ' +
              titleCase(currentMeta.difficulty) +
              ' • ' +
              currentMeta.solutionCount +
              ' ' +
              (currentMeta.solutionCount === 1 ? 'solution' : 'solutions'),
            showShare: true,
            primaryLabel: 'New Number',
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
    setSuccessModal({
      visible: false,
      title: '',
      subtitle: '',
      showShare: false,
      primaryLabel: 'Home',
      primaryAction: 'home',
    });

    if (primaryAction === 'home') {
      setScreen('menu');
      return;
    }

    if (primaryAction === 'next') {
      loadAnotherFromCurrentMode();
    }
  }

  const glowColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: ['#0f1520', '#173324'],
  });

  const completion = useMemo(() => {
    return ((history.length / TOTAL_SOLVABLE) * 100).toFixed(2);
  }, [history.length]);

  const dailySubtitle =
    dailyState && dailyState.completedAt
      ? 'Done in ' + formatSeconds(dailyState.elapsedSeconds || 0)
      : 'Timed daily puzzle';

  const visibleDailyTime =
    dailyState && dailyState.completedAt ? dailyState.elapsedSeconds || 0 : dailyTimerSeconds;

  const modeLabel =
    screen === 'play-daily'
      ? 'Daily Commute'
      : screen === 'play-random'
      ? 'Random Challenge'
      : 'Live Commute';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {screen === 'menu' && (
          <ScrollView
            style={styles.menuScroll}
            contentContainerStyle={styles.menuScrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.menuTopSpacer} />

            <View style={styles.heroCardHome}>
              <View style={styles.heroHeaderBlock}>
                <View style={styles.logoRow}>
                  <View style={[styles.routeDotSmall, { backgroundColor: '#ee352e' }]}>
                    <Text style={styles.routeDotTextSmall}>1</Text>
                  </View>
                  <View style={[styles.routeDotSmall, { backgroundColor: '#00933c' }]}>
                    <Text style={styles.routeDotTextSmall}>4</Text>
                  </View>
                  <View style={[styles.routeDotSmall, { backgroundColor: '#2850ad' }]}>
                    <Text style={styles.routeDotTextSmall}>A</Text>
                  </View>
                  <View style={[styles.routeDotSmall, { backgroundColor: '#b933ad' }]}>
                    <Text style={styles.routeDotTextSmall}>7</Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.helpButtonHomeStrong} onPress={() => setShowHelp(true)}>
                  <Text style={styles.helpTextHomeStrong}>HOW TO PLAY</Text>
                </TouchableOpacity>
              </View>

              <Text
                style={styles.titleCompact}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
              >
                Commuter Game
              </Text>

              <Text style={styles.heroBannerTextWide}>
                Inspired by spotting a 4-digit car number on the train, subway, or bus.
              </Text>

              <View style={styles.heroRuleCard}>
                <Text style={styles.heroRuleText}>Keep the digits in order</Text>
                <Text style={styles.heroRuleDot}>•</Text>
                <Text style={styles.heroRuleText}>Build a math expression</Text>
                <Text style={styles.heroRuleDot}>•</Text>
                <Text style={styles.heroRuleText}>Make 10</Text>
              </View>
            </View>

            <View style={styles.menuCardStack}>
              <TouchableOpacity
                style={[styles.menuCard, !storageLoaded ? styles.menuCardDisabled : null]}
                onPress={startDaily}
              >
                <View>
                  <Text style={styles.modeTitle}>Daily Commute</Text>
                  {!storageLoaded ? (
                    <ActivityIndicator size="small" color="#f5c521" style={styles.cardLoadingSpinner} />
                  ) : (
                    <Text style={styles.modeAccentText}>
                      {'Daily #' + getDailyGameNumber(dailyState.dateKey)}
                    </Text>
                  )}
                  <Text style={styles.modeSubText}>{dailySubtitle}</Text>
                </View>
                <Text style={styles.cardArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuCard} onPress={startLiveCommute}>
                <View>
                  <Text style={styles.modeTitle}>Live Commute</Text>
                  <Text style={styles.modeAccentTextYellow}>Enter any 4-digit number</Text>
                  <Text style={styles.modeSubText}>Check if it works and see its mode</Text>
                </View>
                <Text style={styles.cardArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuCard} onPress={openRandomPrompt}>
                <View>
                  <Text style={styles.modeTitle}>Random Challenge</Text>
                  <Text style={styles.modeAccentTextYellow}>Fresh solvable number</Text>
                  <Text style={styles.modeSubText}>Start a new puzzle in Simple or Complex</Text>
                </View>
                <Text style={styles.cardArrow}>›</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}

        {(screen === 'play-daily' || screen === 'play-random' || screen === 'play-live') && (
          <ScrollView
            style={styles.playScroll}
            contentContainerStyle={styles.playScrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Animated.View style={[styles.heroCardPlay, { backgroundColor: glowColor }]}>
              <View style={styles.heroTopRow}>
                <View style={styles.titleWrapPlay}>
                  <Text
                    style={styles.titlePlay}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                  >
                    Commuter Game
                  </Text>
                  <Text style={styles.subtitlePlay}>{modeLabel}</Text>
                </View>

                <View style={styles.topButtonGroup}>
                  <TouchableOpacity
                    style={styles.homeButtonPlay}
                    onPress={() => {
                      setShowRevealedSolution(false);
                      setScreen('menu');
                    }}
                  >
                    <Text style={styles.homeTextPlay}>Home</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.helpButtonPlayStrong} onPress={() => setShowHelp(true)}>
                    <Text style={styles.helpTextPlayStrong}>Info</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.currentHeaderRow}>
                <Text style={styles.currentNumberLabel}>CURRENT NUMBER</Text>
                {screen === 'play-daily' ? (
                  <View style={styles.timerPill}>
                    <Text style={styles.timerText}>{formatSeconds(visibleDailyTime)}</Text>
                  </View>
                ) : (
                  <View style={styles.currentHeaderSpacer} />
                )}
              </View>

              <View style={styles.signPanel}>
                <Text style={styles.bigDigits}>{digits}</Text>
                <Text style={styles.compactRuleText}>
                  Use the digits in order to create an expression that equals 10.
                </Text>

                <View style={styles.metaRow}>
                  <View style={difficultyPillStyle(currentMeta.difficulty)}>
                    <Text style={styles.difficultyPillText}>{titleCase(currentMeta.difficulty)}</Text>
                  </View>

                  <View style={styles.solutionCountPill}>
                    <Text style={styles.solutionCountText}>
                      {currentMeta.solutionCount} {currentMeta.solutionCount === 1 ? 'solution' : 'solutions'}
                    </Text>
                  </View>
                </View>

                {(screen === 'play-live' || screen === 'play-random') && !!solution && (
                  <>
                    <TouchableOpacity
                      style={styles.showSolutionButton}
                      onPress={() => setShowRevealedSolution((prev) => !prev)}
                    >
                      <Text style={styles.showSolutionButtonText}>
                        {showRevealedSolution ? 'Hide Solution' : 'Show Solution'}
                      </Text>
                    </TouchableOpacity>

                    {showRevealedSolution && (
                      <>
                        <View style={styles.revealedSolutionBox}>
                          <Text style={styles.revealedSolutionLabel}>SOLUTION</Text>
                          <Text style={styles.revealedSolutionText}>{solution} = 10</Text>
                        </View>

                        <TouchableOpacity
                          style={styles.newNumberButton}
                          onPress={loadAnotherFromCurrentMode}
                        >
                          <Text style={styles.newNumberButtonText}>New Number</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </>
                )}
              </View>

              <View style={styles.expressionBox}>
                <Text numberOfLines={1} style={styles.expressionText}>
                  {expression || 'Build your expression'}
                </Text>
              </View>

              {!!inlineMessage && (
                <View style={styles.statusBox}>
                  <Text style={styles.statusText}>{inlineMessage}</Text>
                </View>
              )}

              {(screen === 'play-daily' && dailyState && dailyState.completedAt) || successModal.visible ? (
                <View style={styles.solvedBadge}>
                  <Text style={styles.solvedBadgeText}>SOLVED</Text>
                </View>
              ) : null}
            </Animated.View>

            <View style={styles.padCard}>
              <Text style={styles.sectionEyebrow}>DIGITS</Text>
              <View style={styles.digitsRow}>
                {digits.split('').map((digit, index) => (
                  <TouchableOpacity key={index} style={styles.digitKey} onPress={() => appendToken(digit)}>
                    <Text style={styles.digitKeyText}>{digit}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.sectionEyebrow}>OPERATORS</Text>
              <View style={styles.opsRow}>
                {OPERATORS.map((token) => (
                  <TouchableOpacity key={token} style={styles.opKey} onPress={() => appendToken(token)}>
                    <Text style={styles.opKeyText}>{token}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.bottomButtonRow}>
                <TouchableOpacity style={styles.bottomButton} onPress={clearExpression}>
                  <Text style={styles.bottomButtonText}>Clear</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.bottomButton} onPress={deleteLast}>
                  <Text style={styles.bottomButtonText}>Delete</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionButtonGreen} onPress={check}>
                  <Text style={styles.actionButtonText}>Check</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        )}

        {screen === 'library' && (
          <>
            <View style={styles.heroCardPlay}>
              <View style={styles.heroTopRow}>
                <View style={styles.titleWrapPlay}>
                  <Text style={styles.titlePlay}>Library</Text>
                  <Text style={styles.subtitlePlay}>Solved numbers</Text>
                </View>
              </View>
            </View>

            <View style={styles.libraryStatsRow}>
              <View style={styles.libraryStatCard}>
                <Text style={styles.libraryStatLabel}>Solved before</Text>
                <Text style={styles.libraryStatValue}>{history.length}</Text>
              </View>

              <View style={styles.libraryStatCard}>
                <Text style={styles.libraryStatLabel}>Completion</Text>
                <Text style={styles.libraryStatValue}>{completion}%</Text>
              </View>
            </View>

            <Text style={styles.libraryHelperText}>
              Completion = percent of all solvable 4-digit combinations.
            </Text>

            <ScrollView style={styles.historyScroll}>
              {history.map((item) => {
                const itemMeta = analyzeDigits(item.digits);

                return (
                  <View key={item.id} style={styles.historyItem}>
                    <Text style={styles.historyDigits}>{item.digits}</Text>
                    <Text style={styles.historyExpression}>{item.expression}</Text>

                    <View style={styles.historyMetaRow}>
                      <View style={difficultyPillStyle(itemMeta.difficulty)}>
                        <Text style={styles.difficultyPillText}>{titleCase(itemMeta.difficulty)}</Text>
                      </View>

                      <View style={styles.solutionCountPillHistory}>
                        <Text style={styles.solutionCountTextHistory}>
                          {itemMeta.solutionCount} {itemMeta.solutionCount === 1 ? 'solution' : 'solutions'}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}

        <View style={styles.bottomTabBar}>
          <TouchableOpacity
            style={[styles.bottomTab, screen !== 'library' ? styles.bottomTabActive : null]}
            onPress={() => {
              setShowRevealedSolution(false);
              setScreen('menu');
            }}
          >
            <Text style={[styles.bottomTabText, screen !== 'library' ? styles.bottomTabTextActive : null]}>
              Play
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomTab, screen === 'library' ? styles.bottomTabActive : null]}
            onPress={() => {
              setShowRevealedSolution(false);
              setScreen('library');
            }}
          >
            <Text style={[styles.bottomTabText, screen === 'library' ? styles.bottomTabTextActive : null]}>
              Library
            </Text>
          </TouchableOpacity>
        </View>

        <Modal visible={showHelp} transparent animationType="slide" onRequestClose={() => setShowHelp(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.helpTitle}>How to play</Text>
              <Text style={styles.helpSub}>Simple rules. Fast solve.</Text>

              <ScrollView style={styles.helpScroll}>
                <Text style={styles.helpBody}>
                  {[
                    'Inspired by spotting a 4-digit car number on the train, subway, or bus.',
                    'Use all four digits in the same order they appear.',
                    'Create a math expression that equals 10.',
                    'Allowed operators:' + NL + '+  -  *  /  ^  ( )',
                    'You can combine neighboring digits to make larger numbers like 23 or 68.',
                  ].join(NL + NL)}
                </Text>

                <View style={styles.helpExampleCard}>
                  <Text style={styles.helpExampleLabel}>Example</Text>
                  <Text style={styles.helpExampleDigits}>2368</Text>
                  <Text style={styles.helpExampleExpression}>(2 * (3 + 6)) - 8 = 10</Text>
                </View>
              </ScrollView>

              <TouchableOpacity style={styles.modalBackButton} onPress={() => setShowHelp(false)}>
                <Text style={styles.modalBackButtonText}>Back</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={showLivePrompt} transparent animationType="fade" onRequestClose={() => setShowLivePrompt(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.liveModalCard}>
              <Text style={styles.liveModalTitle}>Live Commute</Text>
              <Text style={styles.liveModalSub}>Enter any 4-digit number and see whether it can make 10.</Text>

              <TextInput
                value={liveInput}
                onChangeText={setLiveInput}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="2368"
                placeholderTextColor="#6f8099"
                style={styles.liveInput}
              />

              {!!livePlayableMessage && <Text style={styles.liveMessage}>{livePlayableMessage}</Text>}

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.actionButtonBlue} onPress={() => setShowLivePrompt(false)}>
                  <Text style={styles.actionButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionButtonGreen} onPress={submitLiveCommute}>
                  <Text style={styles.actionButtonText}>Check</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={showRandomPrompt}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!randomLoading) setShowRandomPrompt(false);
          }}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.randomModalCard}>
              <Text style={styles.liveModalTitle}>Random Challenge</Text>
              <Text style={styles.liveModalSub}>Choose a mode and generate a solvable number.</Text>

              <View style={styles.randomDifficultyRow}>
                {['simple', 'complex'].map((level) => (
                  <TouchableOpacity
                    key={level}
                    style={[
                      styles.randomDifficultyButton,
                      selectedRandomDifficulty === level ? styles.randomDifficultyButtonActive : null,
                    ]}
                    onPress={() => !randomLoading && setSelectedRandomDifficulty(level)}
                    disabled={randomLoading}
                  >
                    <Text
                      style={[
                        styles.randomDifficultyButtonText,
                        selectedRandomDifficulty === level ? styles.randomDifficultyButtonTextActive : null,
                      ]}
                    >
                      {titleCase(level)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {randomLoading ? (
                <View style={styles.randomLoadingWrap}>
                  <ActivityIndicator size="small" color="#e7edf7" />
                  <Text style={styles.randomLoadingText}>Finding a puzzle...</Text>
                </View>
              ) : null}

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionButtonBlue, randomLoading ? styles.bottomButtonDisabled : null]}
                  onPress={() => setShowRandomPrompt(false)}
                  disabled={randomLoading}
                >
                  <Text style={styles.actionButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButtonGreen, randomLoading ? styles.bottomButtonDisabled : null]}
                  onPress={() => startRandomWithDifficulty(selectedRandomDifficulty)}
                  disabled={randomLoading}
                >
                  <Text style={styles.actionButtonText}>Start</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={successModal.visible}
          transparent
          animationType="fade"
          onRequestClose={() => closeSuccess(successModal.primaryAction)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.successModalCard}>
              <Text style={styles.successTitle}>{successModal.title}</Text>
              <Text style={styles.successSubtitle}>{successModal.subtitle}</Text>

              <View style={styles.actionRow}>
                {successModal.showShare ? (
                  <TouchableOpacity style={styles.actionButtonBlue} onPress={shareCurrentResult}>
                    <Text style={styles.actionButtonText}>Share</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.actionButtonGreen}
                  onPress={() => closeSuccess(successModal.primaryAction)}
                >
                  <Text style={styles.actionButtonText}>{successModal.primaryLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

function emptyMeta() {
  return {
    solution: null,
    solutionCount: 0,
    difficulty: 'simple',
  };
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
    if (index === digits.length) {
      partitions.push(parts.slice());
      return;
    }

    for (let end = index + 1; end <= digits.length; end += 1) {
      parts.push(digits.slice(index, end));
      partition(end, parts);
      parts.pop();
    }
  }

  partition(0, []);

  const exactSolutions = new Set();
  let firstSolution = null;
  let easiestScore = Infinity;

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
  const difficulty = classifyDifficulty(solutionCount, easiestScore);

  const result = {
    solution: firstSolution,
    solutionCount,
    difficulty,
  };

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
    const left = buildExpressions(parts.slice(0, split));
    const right = buildExpressions(parts.slice(split));

    for (let i = 0; i < left.length; i += 1) {
      for (let j = 0; j < right.length; j += 1) {
        out.push({
          expr: '(' + left[i].expr + '+' + right[j].expr + ')',
          value: left[i].value + right[j].value,
        });

        out.push({
          expr: '(' + left[i].expr + '-' + right[j].expr + ')',
          value: left[i].value - right[j].value,
        });

        out.push({
          expr: '(' + left[i].expr + '*' + right[j].expr + ')',
          value: left[i].value * right[j].value,
        });

        if (Math.abs(right[j].value) > 0.000000001) {
          out.push({
            expr: '(' + left[i].expr + '/' + right[j].expr + ')',
            value: left[i].value / right[j].value,
          });
        }

        if (
          Number.isInteger(left[i].value) &&
          Number.isInteger(right[j].value) &&
          right[j].value >= 0 &&
          right[j].value <= 6
        ) {
          const powerValue = Math.pow(left[i].value, right[j].value);
          if (Number.isFinite(powerValue) && Math.abs(powerValue) < 1000000) {
            out.push({
              expr: '(' + left[i].expr + '^' + right[j].expr + ')',
              value: powerValue,
            });
          }
        }
      }
    }
  }

  EXPRESSION_CACHE.set(cacheKey, out);
  return out;
}

function scoreExpression(expr) {
  const operatorMatches = expr.match(/[+\-*/^]/g) || [];
  const hasPower = expr.indexOf('^') >= 0;
  const parenCount = (expr.match(/[()]/g) || []).length;
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

    if (meta.solution && meta.difficulty === level) {
      return candidate;
    }
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
  const start = new Date(DAILY_GAME_EPOCH + 'T00:00:00');
  const current = new Date(dateKey + 'T00:00:00');
  const diff = current.getTime() - start.getTime();
  return Math.floor(diff / 86400000) + 1;
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
  return [styles.difficultyPillBase, level === 'simple' ? styles.difficultySimple : styles.difficultyComplex];
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#07111f',
  },

  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 16 : 6,
    paddingBottom: 12,
    backgroundColor: '#07111f',
  },

  menuScroll: {
    flex: 1,
  },

  menuScrollContent: {
    paddingBottom: 10,
  },

  playScroll: {
    flex: 1,
  },

  playScrollContent: {
    paddingBottom: 8,
  },

  menuTopSpacer: {
    height: Platform.OS === 'android' ? 18 : 10,
  },

  heroCardHome: {
    backgroundColor: '#101826',
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1b2739',
    marginBottom: 12,
    marginTop: 4,
  },

  heroCardPlay: {
    borderRadius: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1b2739',
    marginBottom: 10,
  },

  heroHeaderBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },

  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },

  logoRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },

  routeDotSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  routeDotTextSmall: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  titleWrapPlay: {
    flex: 1,
    paddingRight: 10,
  },

  titleCompact: {
    color: '#f2f6fb',
    fontSize: 31,
    fontWeight: '900',
    letterSpacing: 0.2,
    marginBottom: 6,
  },

  titlePlay: {
    color: '#f2f6fb',
    fontSize: 27,
    fontWeight: '900',
    letterSpacing: 0.2,
  },

  subtitlePlay: {
    color: '#93a2bf',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },

  helpButtonHomeStrong: {
    backgroundColor: '#3050b2',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },

  helpTextHomeStrong: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  topButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },

  homeButtonPlay: {
    backgroundColor: '#1b2739',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  homeTextPlay: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },

  helpButtonPlayStrong: {
    backgroundColor: '#3050b2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  helpTextPlayStrong: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },

  heroBannerTextWide: {
    color: '#d6dfeb',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },

  heroRuleCard: {
    backgroundColor: '#0a1019',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1b2739',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },

  heroRuleText: {
    color: '#f2f6fb',
    fontSize: 14,
    fontWeight: '800',
  },

  heroRuleDot: {
    color: '#f5c521',
    fontSize: 16,
    fontWeight: '900',
  },

  menuCardStack: {
    gap: 10,
    marginBottom: 10,
  },

  menuCard: {
    backgroundColor: '#101826',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1b2739',
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  menuCardDisabled: {
    opacity: 0.6,
  },

  cardLoadingSpinner: {
    alignSelf: 'flex-start',
    marginVertical: 4,
  },

  cardArrow: {
    color: '#8a99b4',
    fontSize: 28,
    fontWeight: '700',
  },

  modeTitle: {
    color: '#f2f6fb',
    fontSize: 21,
    fontWeight: '900',
    marginBottom: 4,
  },

  modeAccentText: {
    color: '#f5c521',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 4,
  },

  modeAccentTextYellow: {
    color: '#f5c521',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 4,
  },

  modeSubText: {
    color: '#8a99b4',
    fontSize: 12,
  },

  currentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 6,
  },

  currentNumberLabel: {
    color: '#93a2bf',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2.3,
  },

  currentHeaderSpacer: {
    width: 1,
    height: 1,
  },

  timerPill: {
    backgroundColor: '#182130',
    borderWidth: 1,
    borderColor: '#314562',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  timerText: {
    color: '#f5c521',
    fontSize: 13,
    fontWeight: '900',
  },

  signPanel: {
    backgroundColor: '#05070a',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2c3542',
    alignItems: 'center',
  },

  bigDigits: {
    color: '#f2f6fb',
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 4,
    marginBottom: 4,
  },

  compactRuleText: {
    color: '#aebbd0',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 8,
  },

  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },

  difficultyPillBase: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  difficultySimple: {
    backgroundColor: '#0d6b2f',
  },

  difficultyComplex: {
    backgroundColor: '#8f2637',
  },

  difficultyPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },

  solutionCountPill: {
    backgroundColor: '#223047',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#314562',
  },

  solutionCountText: {
    color: '#d8e2f2',
    fontSize: 11,
    fontWeight: '900',
  },

  solutionCountPillHistory: {
    backgroundColor: '#223047',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#314562',
  },

  solutionCountTextHistory: {
    color: '#d8e2f2',
    fontSize: 11,
    fontWeight: '900',
  },

  showSolutionButton: {
    marginTop: 12,
    backgroundColor: '#3050b2',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },

  showSolutionButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },

  revealedSolutionBox: {
    width: '100%',
    marginTop: 10,
    backgroundColor: '#172131',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#314562',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  revealedSolutionLabel: {
    color: '#93a2bf',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 4,
    textAlign: 'center',
  },

  revealedSolutionText: {
    color: '#f5c521',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },

  newNumberButton: {
    marginTop: 10,
    backgroundColor: '#009d39',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    width: '100%',
  },

  newNumberButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  expressionBox: {
    backgroundColor: '#172131',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },

  expressionText: {
    color: '#d6dfeb',
    fontSize: 15,
    fontWeight: '800',
  },

  statusBox: {
    backgroundColor: '#101f4a',
    borderWidth: 1,
    borderColor: '#1b3e99',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 2,
  },

  statusText: {
    color: '#d8e2f2',
    fontSize: 12,
    fontWeight: '800',
  },

  solvedBadge: {
    marginTop: 8,
    alignSelf: 'center',
    backgroundColor: '#0d6b2f',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  solvedBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },

  actionButtonBlue: {
    flex: 1,
    backgroundColor: '#3050b2',
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },

  actionButtonGreen: {
    flex: 1,
    backgroundColor: '#009d39',
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },

  actionButtonText: {
    color: '#e7edf7',
    fontSize: 15,
    fontWeight: '900',
  },

  padCard: {
    backgroundColor: '#0f1520',
    borderRadius: 18,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1b2739',
    marginBottom: 8,
  },

  sectionEyebrow: {
    color: '#8a99b4',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2.4,
    marginBottom: 8,
  },

  digitsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },

  digitKey: {
    flex: 1,
    backgroundColor: '#c9d4e2',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },

  digitKeyText: {
    color: '#11161f',
    fontSize: 18,
    fontWeight: '900',
  },

  opsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    columnGap: 8,
    marginBottom: 10,
  },

  opKey: {
    width: '23%',
    backgroundColor: '#c9d4e2',
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },

  opKeyText: {
    color: '#11161f',
    fontSize: 16,
    fontWeight: '900',
  },

  bottomButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },

  bottomButton: {
    flex: 1,
    backgroundColor: '#1b2a43',
    borderRadius: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },

  bottomButtonDisabled: {
    opacity: 0.45,
  },

  bottomButtonText: {
    color: '#e7edf7',
    fontSize: 15,
    fontWeight: '900',
  },

  libraryStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },

  libraryStatCard: {
    flex: 1,
    backgroundColor: '#0f1520',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1b2739',
  },

  libraryStatLabel: {
    color: '#8a99b4',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
  },

  libraryStatValue: {
    color: '#e7edf7',
    fontSize: 24,
    fontWeight: '900',
  },

  libraryHelperText: {
    color: '#8a99b4',
    fontSize: 12,
    marginBottom: 8,
  },

  historyScroll: {
    flex: 1,
  },

  historyItem: {
    backgroundColor: '#0f1520',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1b2739',
    marginBottom: 8,
  },

  historyDigits: {
    color: '#e7edf7',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 4,
  },

  historyExpression: {
    color: '#8a99b4',
    fontSize: 14,
  },

  historyMetaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },

  bottomTabBar: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#0f1520',
    borderRadius: 20,
    padding: 8,
    borderWidth: 1,
    borderColor: '#1b2739',
    marginTop: 4,
    marginBottom: 2,
  },

  bottomTab: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 11,
    alignItems: 'center',
  },

  bottomTabActive: {
    backgroundColor: '#3050b2',
  },

  bottomTabText: {
    color: '#8a99b4',
    fontSize: 15,
    fontWeight: '900',
  },

  bottomTabTextActive: {
    color: '#e7edf7',
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 18,
  },

  modalCard: {
    backgroundColor: '#0f1520',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1b2739',
    maxHeight: '82%',
  },

  helpTitle: {
    color: '#e7edf7',
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 4,
  },

  helpSub: {
    color: '#8a99b4',
    fontSize: 14,
    marginBottom: 12,
  },

  helpScroll: {
    maxHeight: 320,
  },

  helpBody: {
    color: '#c7d4e5',
    fontSize: 15,
    lineHeight: 24,
  },

  helpExampleCard: {
    backgroundColor: '#172131',
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
  },

  helpExampleLabel: {
    color: '#8a99b4',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 8,
  },

  helpExampleDigits: {
    color: '#f2f6fb',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 8,
    marginBottom: 8,
  },

  helpExampleExpression: {
    color: '#f5c521',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },

  modalBackButton: {
    backgroundColor: '#009d39',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },

  modalBackButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },

  liveModalCard: {
    backgroundColor: '#0f1520',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1b2739',
  },

  randomModalCard: {
    backgroundColor: '#0f1520',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1b2739',
  },

  liveModalTitle: {
    color: '#e7edf7',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 6,
  },

  liveModalSub: {
    color: '#8a99b4',
    fontSize: 14,
    marginBottom: 12,
  },

  liveInput: {
    backgroundColor: '#172131',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2c3a50',
    color: '#e7edf7',
    fontSize: 20,
    fontWeight: '800',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
    letterSpacing: 4,
  },

  liveMessage: {
    color: '#d8e2f2',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },

  randomDifficultyRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },

  randomDifficultyButton: {
    flex: 1,
    backgroundColor: '#172131',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c3a50',
  },

  randomDifficultyButtonActive: {
    backgroundColor: '#3050b2',
    borderColor: '#4f74dc',
  },

  randomDifficultyButtonText: {
    color: '#d8e2f2',
    fontSize: 14,
    fontWeight: '800',
  },

  randomDifficultyButtonTextActive: {
    color: '#ffffff',
  },

  randomLoadingWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },

  randomLoadingText: {
    color: '#d8e2f2',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },

  successModalCard: {
    backgroundColor: '#0f1520',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1b2739',
  },

  successTitle: {
    color: '#e7edf7',
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 6,
    textAlign: 'center',
  },

  successSubtitle: {
    color: '#c7d4e5',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
  },
});