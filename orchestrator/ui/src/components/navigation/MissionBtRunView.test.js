// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Seongwoo Kim

import { useLayoutEffect, useRef } from "react";
import { render, screen } from "@testing-library/react";
import MissionBtRunView from "./MissionBtRunView";

jest.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, children }) => (
    <div data-testid="react-flow">
      {nodes.map((node) => <span key={node.id}>{node.data.label}</span>)}
      {children}
    </div>
  ),
  Controls: () => null,
  Background: () => null,
}));

const EMPTY_TREE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
  '  <BehaviorTree ID="MainTree"/>',
  "</root>",
].join("\n");

const POPULATED_TREE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
  '  <BehaviorTree ID="MainTree">',
  '    <Sequence name="Sequence A">',
  '      <Wait name="Wait A" msec="1000"/>',
  '    </Sequence>',
  '  </BehaviorTree>',
  '</root>',
].join("\n");

function FirstCommitProbe({ children, onCommit }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    onCommit(ref.current?.textContent || "");
  }, [onCommit]);
  return <div ref={ref}>{children}</div>;
}

// The ReactFlow-backed graph needs a real layout engine, so these assertions
// cover the plain-DOM states the viewer falls back to.
test("shows a navigate-only message when the waypoint has no behavior tree", () => {
  render(<MissionBtRunView xml={EMPTY_TREE} activeNodeNames={[]} />);
  expect(screen.getByText("Navigate only")).toBeInTheDocument();
  expect(screen.getByText("This waypoint has no behavior tree.")).toBeInTheDocument();
});

test("shows a loading state while the tree is being fetched", () => {
  render(<MissionBtRunView xml="" activeNodeNames={[]} loading />);
  expect(screen.getByText("Loading behavior tree...")).toBeInTheDocument();
});

test("renders waypoint nodes in the first committed frame", () => {
  const commits = [];
  const recordCommit = (text) => commits.push(text);

  render(
    <FirstCommitProbe onCommit={recordCommit}>
      <MissionBtRunView xml={POPULATED_TREE} activeNodeNames={[]} />
    </FirstCommitProbe>,
  );

  expect(commits[0]).toContain("Sequence A");
  expect(commits[0]).toContain("Wait A");
  expect(commits[0]).not.toContain("Navigate only");
});
