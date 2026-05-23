// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import { ToolsTable } from '../../../components/tools-table';
import { DATA } from '../../../mock/data';

export default function PackToolsScreen() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const tools = DATA.tools.filter((t) => slug && t.packs.includes(slug));
  return <ToolsTable tools={tools} scopedToPack={slug} />;
}
