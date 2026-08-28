'use strict';

// GENERATED TEST SNAPSHOT: exact scoring unit extracted from the canonical Apps Script runtime.

// Full canonical source SHA-256: 9c9ad70781a75e04c7bab11528f09fe27b2eed3287a9a2acc0706cd0f881783e

// Contains no production identity, credentials, network calls, or deployment configuration.

var HEALTH_SCORING_CONFIG = {
  algorithmVersion: 'health-score-v1.0',
  baselineWindows: [7, 28, 90],
  minimumBaselineDays: 3,
  defaultSleepRequirementMinutes: 480,
  defaultStepTarget: 7000,
  defaultNutritionTargets: { calories: 2000, protein: 100, carbs: 250, fat: 65 },
  sleepWeights: { duration: 0.30, efficiency: 0.20, deep: 0.15, rem: 0.10, continuity: 0.10, regularity: 0.10, nightHeartRate: 0.05 },
  recoveryWeights: { hrv: 0.35, restingHeartRate: 0.25, sleep: 0.20, training: 0.15, subjective: 0.05 },
  fatigueWeights: { shortTrainingLoad: 0.35, sleepDebt: 0.25, hrvSuppression: 0.20, restingHeartRateElevation: 0.10, consecutiveTrainingDays: 0.10 },
  healthWeights: { sleep: 0.25, recovery: 0.20, activity: 0.15, training: 0.15, nutrition: 0.15, bodyComposition: 0.10 }
};

// ===== healthScoringEngine.gs =====
function hsNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return null;
  var number = Number(value);
  return isFinite(number) ? number : null;
}

function hsRound_(value, decimals) {
  if (value === null) return null;
  var factor = Math.pow(10, decimals === undefined ? 1 : decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function hsClamp_(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hsMean_(values) {
  var numbers = (values || []).map(hsNumber_).filter(function(value) { return value !== null; });
  return numbers.length ? numbers.reduce(function(sum, value) { return sum + value; }, 0) / numbers.length : null;
}

function hsMedian_(values) {
  var numbers = (values || []).map(hsNumber_).filter(function(value) { return value !== null; })
    .sort(function(a, b) { return a - b; });
  if (!numbers.length) return null;
  var middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function hsRobustValues_(values) {
  var numbers = (values || []).map(hsNumber_).filter(function(value) { return value !== null; });
  if (numbers.length < 5) return numbers;
  var median = hsMedian_(numbers);
  var deviations = numbers.map(function(value) { return Math.abs(value - median); });
  var mad = hsMedian_(deviations);
  if (!mad) return numbers;
  return numbers.filter(function(value) { return Math.abs(value - median) <= mad * 4.5; });
}

var HEALTH_SCORE_METADATA_DOMAINS_ = ['sleep', 'recovery', 'fatigue', 'activity', 'training', 'nutrition', 'bodyComposition'];
var HEALTH_SCORE_COVERAGE_DOMAINS_ = ['sleep', 'recovery', 'activity', 'training', 'nutrition', 'bodyComposition'];

function normalizeHealthCompleteness_(value) {
  if (value !== null && typeof value === 'object') return null;
  var number = hsNumber_(value);
  if (number === null) return null;
  if (number > 1) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[HealthScore] legacy completeness normalized', { value: number });
    number = number / 100;
  }
  return hsRound_(hsClamp_(number, 0, 1), 4);
}

function hsConfidence_(completeness, sampleCount) {
  completeness = normalizeHealthCompleteness_(completeness);
  if (completeness !== null && completeness >= 0.8 && (sampleCount === undefined || sampleCount >= 7)) return 'HIGH';
  if (completeness !== null && completeness >= 0.5 && (sampleCount === undefined || sampleCount >= 3)) return 'MEDIUM';
  return 'LOW';
}

function normalizeHealthConfidence_(confidence, completeness) {
  var normalized = String(confidence || '').toUpperCase();
  var maximum = hsConfidence_(completeness);
  var rank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  if (!rank[normalized]) return maximum;
  return rank[normalized] > rank[maximum] ? maximum : normalized;
}

function calculateDataCompleteness(components, weights) {
  var totalWeight = 0;
  var availableWeight = 0;
  Object.keys(weights || {}).forEach(function(key) {
    var weight = Number(weights[key]) || 0;
    totalWeight += weight;
    if (components && hsNumber_(components[key]) !== null) availableWeight += weight;
  });
  return totalWeight ? hsRound_(availableWeight / totalWeight, 4) : 0;
}

function buildHealthScoreMetadata_(bundle, options) {
  bundle = bundle || {};
  options = options || {};
  var availableDomains = [];
  var missingDomains = [];
  var partialDomains = [];
  var domainCompleteness = {};
  HEALTH_SCORE_METADATA_DOMAINS_.forEach(function(domain) {
    var result = bundle[domain] || {};
    var score = hsNumber_(result.score);
    var componentCompleteness = normalizeHealthCompleteness_(result.completeness);
    if (score === null) {
      missingDomains.push(domain);
      domainCompleteness[domain] = 0;
    }
    else {
      availableDomains.push(domain);
      if (Array.isArray(result.missingData) && result.missingData.length) partialDomains.push(domain);
      domainCompleteness[domain] = componentCompleteness === null
        ? (Array.isArray(result.missingData) && result.missingData.length ? null : 1)
        : componentCompleteness;
    }
  });
  var health = bundle.health || {};
  var completeness = normalizeHealthCompleteness_(options.completeness === undefined ? health.nominalCompleteness : options.completeness);
  var metadata = {
    algorithmVersion: String(options.algorithmVersion || (typeof HEALTH_SCORING_CONFIG !== 'undefined' && HEALTH_SCORING_CONFIG.algorithmVersion) || ''),
    completeness: completeness,
    confidence: normalizeHealthConfidence_(options.confidence || health.confidence, completeness),
    availableDomains: availableDomains,
    missingDomains: missingDomains,
    partialDomains: partialDomains,
    domainCompleteness: domainCompleteness,
    completenessSemantic: 'DOMAIN_COVERAGE',
    coverageDomains: HEALTH_SCORE_COVERAGE_DOMAINS_.slice(),
    calculatedAt: options.calculatedAt || '',
    sourceDate: options.sourceDate || ''
  };
  validateHealthScoreMetadata_(metadata);
  return metadata;
}

function validateHealthScoreMetadata_(metadata) {
  if (metadata.completeness !== null && (metadata.completeness < 0 || metadata.completeness > 1)) {
    throw new Error('Health score completeness must be between 0 and 1');
  }
  var available = {};
  (metadata.availableDomains || []).forEach(function(domain) { available[domain] = true; });
  (metadata.missingDomains || []).forEach(function(domain) {
    if (available[domain]) throw new Error('Health score domain cannot be both available and missing: ' + domain);
  });
  if ((metadata.availableDomains || []).indexOf('health') >= 0 || (metadata.missingDomains || []).indexOf('health') >= 0) {
    throw new Error('Aggregate health score is not an input domain');
  }
  Object.keys(metadata.domainCompleteness || {}).forEach(function(domain) {
    var completeness = metadata.domainCompleteness[domain];
    if (completeness !== null && (completeness < 0 || completeness > 1)) {
      throw new Error('Domain completeness must be between 0 and 1: ' + domain);
    }
  });
  return metadata;
}

function hsWeightedScore_(components, weights, options) {
  var weighted = 0;
  var activeWeight = 0;
  var missing = [];
  Object.keys(weights || {}).forEach(function(key) {
    var score = components ? hsNumber_(components[key]) : null;
    var weight = Number(weights[key]) || 0;
    if (score === null) missing.push(key);
    else if (weight > 0) {
      weighted += hsClamp_(score, 0, 100) * weight;
      activeWeight += weight;
    }
  });
  var completeness = calculateDataCompleteness(components, weights);
  var score = activeWeight ? hsRound_(weighted / activeWeight, 1) : null;
  return {
    score: score,
    components: components || {},
    missingData: missing,
    completeness: completeness,
    confidence: hsConfidence_(completeness, options && options.sampleCount),
    activeWeight: hsRound_(activeWeight, 3)
  };
}

function hsTargetRangeScore_(value, lower, upper, outerLower, outerUpper) {
  value = hsNumber_(value);
  if (value === null) return null;
  if (value >= lower && value <= upper) return 100;
  if (value < lower) return hsClamp_((value - outerLower) / Math.max(1, lower - outerLower) * 100, 0, 100);
  return hsClamp_((outerUpper - value) / Math.max(1, outerUpper - upper) * 100, 0, 100);
}

function hsRatioScore_(actual, target, lowerRatio, upperRatio) {
  actual = hsNumber_(actual);
  target = hsNumber_(target);
  if (actual === null || target === null || target <= 0) return null;
  return hsTargetRangeScore_(actual / target, lowerRatio, upperRatio, 0, Math.max(upperRatio * 1.8, 2));
}

function calculateBaselines(dailyFeatures, options) {
  var rows = (dailyFeatures || []).slice().sort(function(a, b) { return String(a.date).localeCompare(String(b.date)); });
  var config = typeof HEALTH_SCORING_CONFIG !== 'undefined' ? HEALTH_SCORING_CONFIG : { baselineWindows: [7, 28, 90], minimumBaselineDays: 3 };
  var windows = options && options.windows || config.baselineWindows || [7, 28, 90];
  var fields = options && options.fields || [
    'hrvRmssd', 'restingHeartRate', 'sleepMinutes', 'sleepStartMinute', 'steps', 'caloriesBurned',
    'trainingLoad', 'weight', 'fatMass'
  ];
  var result = { windows: {}, preferred: {} };
  windows.forEach(function(days) {
    var sample = rows.slice(-days);
    result.windows[days] = {};
    fields.forEach(function(field) {
      var values = hsRobustValues_(sample.map(function(row) { return row[field]; }));
      result.windows[days][field] = {
        value: values.length ? hsRound_(hsMedian_(values), 2) : null,
        mean: values.length ? hsRound_(hsMean_(values), 2) : null,
        count: values.length
      };
    });
  });
  fields.forEach(function(field) {
    var selected = null;
    [28, 90, 7].forEach(function(days) {
      var candidate = result.windows[days] && result.windows[days][field];
      if (!selected && candidate && candidate.count >= (config.minimumBaselineDays || 3)) {
        selected = { value: candidate.value, mean: candidate.mean, count: candidate.count, windowDays: days, fallback: false };
      }
    });
    if (!selected) {
      var available = [];
      windows.forEach(function(days) {
        var candidate = result.windows[days] && result.windows[days][field];
        if (candidate && candidate.count) available.push({ candidate: candidate, days: days });
      });
      if (available.length) {
        available.sort(function(a, b) { return b.candidate.count - a.candidate.count; });
        selected = { value: available[0].candidate.value, mean: available[0].candidate.mean,
          count: available[0].candidate.count, windowDays: available[0].days, fallback: true };
      }
    }
    result.preferred[field] = selected || { value: null, mean: null, count: 0, windowDays: null, fallback: true };
  });
  return result;
}

function calculateSleepScore(input) {
  input = input || {};
  var config = HEALTH_SCORING_CONFIG;
  var minutes = hsNumber_(input.sleepMinutes);
  var requirement = hsNumber_(input.sleepRequirementMinutes) || config.defaultSleepRequirementMinutes;
  var totalInBed = hsNumber_(input.timeInBedMinutes);
  var efficiency = hsNumber_(input.sleepEfficiency);
  if (efficiency === null && minutes !== null && totalInBed !== null && totalInBed > 0) efficiency = minutes / totalInBed * 100;
  var deepRatio = minutes && hsNumber_(input.deepSleepMinutes) !== null ? Number(input.deepSleepMinutes) / minutes * 100 : null;
  var remRatio = minutes && hsNumber_(input.remSleepMinutes) !== null ? Number(input.remSleepMinutes) / minutes * 100 : null;
  var awakeMinutes = hsNumber_(input.awakeMinutes);
  var bedtimeDeviation = hsNumber_(input.bedtimeDeviationMinutes);
  var nightHeartRate = hsNumber_(input.nightHeartRate);
  var heartRateBaseline = hsNumber_(input.restingHeartRateBaseline);
  var components = {
    duration: hsRatioScore_(minutes, requirement, 0.88, 1.12),
    efficiency: efficiency === null ? null : hsTargetRangeScore_(efficiency, 85, 100, 55, 115),
    deep: deepRatio === null ? null : hsTargetRangeScore_(deepRatio, 15, 25, 3, 45),
    rem: remRatio === null ? null : hsTargetRangeScore_(remRatio, 18, 27, 5, 45),
    continuity: awakeMinutes === null || minutes === null ? null : hsClamp_(100 - awakeMinutes / Math.max(1, minutes) * 260, 0, 100),
    regularity: bedtimeDeviation === null ? null : hsClamp_(100 - bedtimeDeviation / 120 * 100, 0, 100),
    nightHeartRate: nightHeartRate === null || heartRateBaseline === null ? null : hsClamp_(100 - Math.max(0, nightHeartRate - heartRateBaseline) * 7, 0, 100)
  };
  var result = hsWeightedScore_(components, config.sleepWeights, { sampleCount: input.baselineSampleCount });
  result.status = result.score === null ? 'NO_DATA' : result.score >= 85 ? 'EXCELLENT' : result.score >= 70 ? 'GOOD' : result.score >= 55 ? 'FAIR' : 'POOR';
  result.source = 'SYSTEM_ESTIMATE';
  result.externalScore = hsNumber_(input.deviceSleepScore);
  result.externalSource = input.deviceSleepScoreSource || '';
  result.sleepRequirementMinutes = requirement;
  result.explanation = result.score === null ? '沒有足夠睡眠資料可計算。' :
    '睡眠分數依可取得的睡眠時數、效率、階段、連續性、規律度與夜間心率計算；缺少項目已自動重分配權重。';
  return result;
}

function calculateActivityScore(input) {
  input = input || {};
  var target = hsNumber_(input.stepTarget) || HEALTH_SCORING_CONFIG.defaultStepTarget;
  var steps = hsNumber_(input.steps);
  var burned = hsNumber_(input.caloriesBurned);
  var baselineCalories = hsNumber_(input.caloriesBurnedBaseline);
  var components = {
    steps: steps === null ? null : hsClamp_(steps / target * 100, 0, 115),
    calories: burned === null || baselineCalories === null ? null : hsRatioScore_(burned, baselineCalories, 0.8, 1.25)
  };
  var result = hsWeightedScore_(components, { steps: 0.7, calories: 0.3 }, { sampleCount: input.baselineSampleCount });
  result.targetSteps = target;
  result.status = result.score === null ? 'NO_DATA' : result.score >= 90 ? 'TARGET_MET' : result.score >= 65 ? 'ACTIVE' : 'LOW_ACTIVITY';
  result.explanation = result.score === null ? '沒有步數或活動消耗資料。' : '依每日步數目標與個人活動消耗 baseline 評估。';
  return result;
}

function calculateTrainingScore(input) {
  input = input || {};
  var dailyLoad = hsNumber_(input.trainingLoad);
  var baseline = hsNumber_(input.trainingLoadBaseline);
  var acute = hsNumber_(input.acuteLoad);
  var chronic = hsNumber_(input.chronicLoad);
  var ratio = acute !== null && chronic !== null && chronic > 0 ? acute / chronic : null;
  var components = {
    dailyLoad: dailyLoad === null ? null : (dailyLoad === 0 ? 75 : baseline === null ? 80 : hsRatioScore_(dailyLoad, baseline, 0.55, 1.45)),
    loadBalance: ratio === null ? null : hsTargetRangeScore_(ratio, 0.75, 1.35, 0.25, 2.25),
    recoverySpacing: hsNumber_(input.consecutiveTrainingDays) === null ? null : hsClamp_(100 - Math.max(0, Number(input.consecutiveTrainingDays) - 3) * 18, 25, 100)
  };
  var result = hsWeightedScore_(components, { dailyLoad: 0.45, loadBalance: 0.40, recoverySpacing: 0.15 }, { sampleCount: input.baselineSampleCount });
  result.acuteLoad = acute;
  result.chronicLoad = chronic;
  result.loadRatio = ratio === null ? null : hsRound_(ratio, 2);
  result.status = result.score === null ? 'NO_DATA' : dailyLoad === 0 ? 'REST_DAY' : ratio !== null && ratio > 1.5 ? 'LOAD_SPIKE' : result.score >= 70 ? 'BALANCED' : 'REVIEW_LOAD';
  result.explanation = '依當日負荷、7 日短期負荷、28 日長期負荷與連續訓練天數評估；不把資料不足的負荷比率冒充 ACWR。';
  return result;
}

function calculateNutritionScore(input) {
  input = input || {};
  var targets = input.targets || {};
  var values = input.values || input;
  var components = {
    calories: hsRatioScore_(values.calories, targets.calories, 0.85, 1.15),
    protein: hsRatioScore_(values.protein, targets.protein, 0.90, 1.25),
    carbs: hsRatioScore_(values.carbs, targets.carbs, 0.70, 1.30),
    fat: hsRatioScore_(values.fat, targets.fat, 0.70, 1.30),
    mealDistribution: hsNumber_(values.mealCount) === null ? null : hsTargetRangeScore_(values.mealCount, 2, 5, 1, 8)
  };
  var result = hsWeightedScore_(components, { calories: 0.30, protein: 0.35, carbs: 0.15, fat: 0.10, mealDistribution: 0.10 });
  result.targetSource = input.targetSource || 'USER';
  result.status = result.score === null ? 'NO_DATA' : result.score >= 80 ? 'ON_TARGET' : result.score >= 60 ? 'PARTIAL' : 'REVIEW_INTAKE';
  result.explanation = result.score === null ? '沒有已確認且營養完整的餐點資料。' : '只使用已確認且營養欄位完整的餐點，並依統一營養目標評估。';
  if (result.targetSource === 'DEFAULT_GUIDELINE' && result.confidence === 'HIGH') result.confidence = 'MEDIUM';
  return result;
}

function calculateBodyCompositionScore(input) {
  input = input || {};
  var weight = hsNumber_(input.weight);
  var fatMass = hsNumber_(input.fatMass);
  var targetWeight = hsNumber_(input.targetWeight);
  var weightBaseline = hsNumber_(input.weightBaseline);
  var fatMassBaseline = hsNumber_(input.fatMassBaseline);
  var weightTrend = weight !== null && weightBaseline !== null ? weight - weightBaseline : null;
  var fatTrend = fatMass !== null && fatMassBaseline !== null ? fatMass - fatMassBaseline : null;
  var goalScore = null;
  if (weight !== null && targetWeight !== null) {
    var distancePct = Math.abs(weight - targetWeight) / Math.max(targetWeight, 1) * 100;
    goalScore = hsClamp_(100 - distancePct * 6, 25, 100);
  }
  var components = {
    goalProgress: goalScore,
    weightStability: weightTrend === null ? null : hsClamp_(100 - Math.abs(weightTrend) * 18, 25, 100),
    fatMassTrend: fatTrend === null ? null : hsClamp_(80 - fatTrend * 30, 20, 100)
  };
  var result = hsWeightedScore_(components, { goalProgress: 0.45, weightStability: 0.25, fatMassTrend: 0.30 }, { sampleCount: input.baselineSampleCount });
  result.status = result.score === null ? 'NO_DATA' : result.score >= 80 ? 'ON_TRACK' : result.score >= 60 ? 'STABLE' : 'REVIEW_TREND';
  result.explanation = targetWeight === null ? '未設定明確體重目標時，以體重穩定度與脂肪重量趨勢評估，不假設越低越好。' : '依使用者目標與體重／脂肪重量趨勢評估。';
  return result;
}

function calculateRecoveryScore(input) {
  input = input || {};
  var hrv = hsNumber_(input.hrvRmssd);
  var hrvBaseline = hsNumber_(input.hrvBaseline);
  var rhr = hsNumber_(input.restingHeartRate);
  var rhrBaseline = hsNumber_(input.restingHeartRateBaseline);
  var subjective = hsNumber_(input.subjectiveRecoveryScore);
  var components = {
    hrv: hrv === null || hrvBaseline === null ? null : hsClamp_(50 + (hrv / hrvBaseline - 1) * 180, 0, 100),
    restingHeartRate: rhr === null || rhrBaseline === null ? null : hsClamp_(100 - Math.max(0, rhr - rhrBaseline) * 8 + Math.max(0, rhrBaseline - rhr) * 2, 0, 100),
    sleep: hsNumber_(input.sleepScore),
    training: hsNumber_(input.trainingRecoveryScore),
    subjective: subjective
  };
  var result = hsWeightedScore_(components, HEALTH_SCORING_CONFIG.recoveryWeights, { sampleCount: input.baselineSampleCount });
  result.status = result.score === null ? 'NO_DATA' : result.score >= 85 ? 'VERY_GOOD' : result.score >= 70 ? 'GOOD' : result.score >= 50 ? 'MODERATE' : 'RECOVERY_NEEDED';
  result.explanation = '恢復分數優先使用個人 HRV／靜止心率 baseline；缺少穿戴資料時，會依睡眠、訓練與主觀狀態重分配權重並降低完整度。';
  return result;
}

function calculateFatigueIndex(input) {
  input = input || {};
  var acute = hsNumber_(input.acuteLoad);
  var chronic = hsNumber_(input.chronicLoad);
  var loadRatio = acute !== null && chronic !== null && chronic > 0 ? acute / chronic : null;
  var debt = hsNumber_(input.sleepDebtMinutes);
  var hrv = hsNumber_(input.hrvRmssd);
  var hrvBaseline = hsNumber_(input.hrvBaseline);
  var rhr = hsNumber_(input.restingHeartRate);
  var rhrBaseline = hsNumber_(input.restingHeartRateBaseline);
  var consecutive = hsNumber_(input.consecutiveTrainingDays);
  var components = {
    shortTrainingLoad: loadRatio === null ? null : hsClamp_((loadRatio - 0.7) / 1.1 * 100, 0, 100),
    sleepDebt: debt === null ? null : hsClamp_(debt / 420 * 100, 0, 100),
    hrvSuppression: hrv === null || hrvBaseline === null ? null : hsClamp_((1 - hrv / hrvBaseline) * 240, 0, 100),
    restingHeartRateElevation: rhr === null || rhrBaseline === null ? null : hsClamp_((rhr - rhrBaseline) * 10, 0, 100),
    consecutiveTrainingDays: consecutive === null ? null : hsClamp_((consecutive - 2) * 22, 0, 100)
  };
  var result = hsWeightedScore_(components, HEALTH_SCORING_CONFIG.fatigueWeights, { sampleCount: input.baselineSampleCount });
  result.status = result.score === null ? 'NO_DATA' : result.score < 30 ? 'LOW' : result.score < 55 ? 'MODERATE' : result.score < 75 ? 'HIGH' : 'VERY_HIGH';
  result.explanation = '疲勞指數是獨立的風險負荷指標（數值越高越疲勞），不是恢復分數的簡單反向。';
  return result;
}

function calculateHealthScore(input) {
  input = input || {};
  var components = {
    sleep: hsNumber_(input.sleepScore),
    recovery: hsNumber_(input.recoveryScore),
    activity: hsNumber_(input.activityScore),
    training: hsNumber_(input.trainingScore),
    nutrition: hsNumber_(input.nutritionScore),
    bodyComposition: hsNumber_(input.bodyCompositionScore)
  };
  var weights = Object.assign({}, HEALTH_SCORING_CONFIG.healthWeights);
  var overlap = components.recovery !== null && (components.sleep !== null || components.training !== null);
  if (overlap) weights.recovery = weights.recovery * 0.5;
  var result = hsWeightedScore_(components, weights);
  result.nominalCompleteness = calculateDataCompleteness(components, HEALTH_SCORING_CONFIG.healthWeights);
  result.dependencyAdjustment = overlap ? 'RECOVERY_WEIGHT_HALVED_TO_LIMIT_SLEEP_TRAINING_DOUBLE_COUNT' : 'NONE';
  result.status = result.score === null ? 'NO_DATA' : result.score >= 85 ? 'EXCELLENT' : result.score >= 70 ? 'GOOD' : result.score >= 55 ? 'FAIR' : 'NEEDS_ATTENTION';
  result.explanation = '總健康分數由可取得的睡眠、恢復、活動、訓練、營養與身體組成分項整合；恢復已使用睡眠或訓練時會降低重疊權重。';
  return result;
}
