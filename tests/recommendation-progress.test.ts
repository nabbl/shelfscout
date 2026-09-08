import { expect, it } from 'vitest';
import { recommendationProgress } from '../src/lib/recommendation/progress';

it('advances through generation steps without claiming completion before saving finishes', () => {
  const stages = ['Building evidence profile', 'Resolving taste evidence 1/3', 'Resolving taste evidence 3/3', 'Planning complementary catalog searches', 'Searching catalog 1/8', 'Searching catalog 8/8', 'Reading catalog evidence 1/4', 'Reading catalog evidence 4/4', 'Checking series starting points', 'Checking series starting points 1/4', 'Finding book one 4/4: A Series', 'Assessing preferences, mood and tradeoffs', 'Assessing preferences, mood and tradeoffs 2/2', 'Ranking recommendations', 'Saving recommendations'];
  const percentages = stages.map(stage => recommendationProgress('running', stage).percent);
  expect(percentages.every(value => value !== null && value >= 0 && value < 100)).toBe(true);
  expect(percentages).toEqual([...percentages].sort((a, b) => a! - b!));
  expect(recommendationProgress('complete').percent).toBe(100);
});

it('counts completed items and exposes the current stage in plain language', () => {
  expect(recommendationProgress('running', 'Searching catalog 3/8')).toEqual({ percent: 31, label: 'Searching for books (3/8)' });
  expect(recommendationProgress('running', 'Reading catalog evidence 3/4').percent).toBe(65);
});

it.each(['Searching catalog 0/8', 'Searching catalog 9/8', 'Searching catalog 1/0', 'Searching catalog 1/999999999999999999999', 'An unfamiliar stage'])('does not invent a percentage for %s', stage => {
  expect(recommendationProgress('running', stage).percent).toBeNull();
});

it('resets queued jobs and treats failures as failures regardless of a stale stage', () => {
  expect(recommendationProgress('queued', 'Saving recommendations')).toEqual({ percent: 0, label: 'Waiting to start' });
  expect(recommendationProgress('failed', 'Saving recommendations')).toEqual({ percent: null, label: 'Generation failed' });
  expect(recommendationProgress().percent).toBeNull();
  expect(recommendationProgress('running', 'Finding book one of A Series').percent).toBe(80);
});
