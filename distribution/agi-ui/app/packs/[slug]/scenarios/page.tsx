// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import { Pill, SearchInput } from '../../../components/m3';
import { DATA } from '../../../mock/data';

export default function PackScenariosScreen() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const scenarios = (slug ? DATA.scenarios[slug] : undefined) ?? DATA.scenarios['support-demo'] ?? [];
  return (
    <div className="tbl-wrap">
      <div className="filterbar">
        <SearchInput value="" onChange={() => {}} placeholder="Search scenarios" width={260} />
        <select className="select">
          <option>Status: any</option>
          <option>passing</option>
          <option>flaky</option>
          <option>failing</option>
        </select>
        <div className="results">{scenarios.length} scenarios · CI: passing</div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Steps</th>
            <th>Tools exercised</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.id}</td>
              <td>{s.name}</td>
              <td className="num">{s.steps}</td>
              <td>
                <div className="row">
                  {s.tools.map((t) => (
                    <Pill key={t}>{t}</Pill>
                  ))}
                </div>
              </td>
              <td>
                {s.status === 'passing' && <Pill kind="good">✓ passing</Pill>}
                {s.status === 'flaky' && <Pill kind="warn">~ flaky</Pill>}
                {s.status === 'failing' && <Pill kind="bad">✕ failing</Pill>}
              </td>
              <td>
                <a className="mono" style={{ fontSize: 11 }}>
                  open ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
