// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import { AuditList } from '../../../components/audit-list';

export default function PackAuditScreen() {
  const params = useParams<{ slug: string }>();
  return <AuditList scopedPack={params?.slug} />;
}
