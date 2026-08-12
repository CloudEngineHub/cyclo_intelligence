import { poseForScanFrame, poseForTfAxesFrame } from './navigationTf';

test('uses the authoritative robot pose for a base_link laser scan', () => {
  const staleTfPose = {
    position: { x: 52, y: 53, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  const amclPose = {
    position: { x: 1.25, y: -0.5, z: 0 },
    orientation: { x: 0, y: 0, z: 0.25, w: 0.97 },
  };

  expect(poseForScanFrame(
    'base_link',
    new Map([['base_link', staleTfPose]]),
    amclPose,
  )).toBe(amclPose);
});

test('retains the TF pose for a laser frame with a sensor offset', () => {
  const laserTfPose = {
    position: { x: 1.5, y: -0.4, z: 0.2 },
    orientation: { x: 0, y: 0, z: 0.25, w: 0.97 },
  };
  const robotPose = {
    position: { x: 1.25, y: -0.5, z: 0 },
    orientation: { x: 0, y: 0, z: 0.25, w: 0.97 },
  };

  expect(poseForScanFrame(
    'base_scan',
    new Map([['base_scan', laserTfPose]]),
    robotPose,
  )).toBe(laserTfPose);
});

test('aligns only the displayed base_link TF axis with the robot pose', () => {
  const staleBaseLinkPose = {
    position: { x: 52, y: 53, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  const odomPose = {
    position: { x: 50, y: 50, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  const amclPose = {
    position: { x: 1.25, y: -0.5, z: 0 },
    orientation: { x: 0, y: 0, z: 0.25, w: 0.97 },
  };

  expect(poseForTfAxesFrame('/base_link', staleBaseLinkPose, amclPose)).toBe(amclPose);
  expect(poseForTfAxesFrame('base_link', staleBaseLinkPose, null)).toBe(staleBaseLinkPose);
  expect(poseForTfAxesFrame('odom', odomPose, amclPose)).toBe(odomPose);
});
