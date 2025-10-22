import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

export const Route = createFileRoute('/cas')({
  component: CAsPage,
});

type SortBy = 'name' | 'issuedDate' | 'expiryDate';
type SortOrder = 'asc' | 'desc';
type Status = 'active' | 'revoked' | 'expired';
type Algorithm = 'RSA-2048' | 'RSA-4096' | 'ECDSA-P256' | 'ECDSA-P384';

function CAsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [algorithm, setAlgorithm] = useState<Algorithm | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('issuedDate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(0);
  const limit = 50;

  const casQuery = trpc.ca.list.useQuery({
    search: search || undefined,
    status: status !== 'all' ? status : undefined,
    algorithm: algorithm !== 'all' ? algorithm : undefined,
    sortBy,
    sortOrder,
    limit,
    offset: page * limit,
  });

  const handleRowClick = (id: string) => {
    navigate({ to: `/cas/${id}` });
  };

  const handleSort = (newSortBy: SortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            Active
          </Badge>
        );
      case 'expired':
        return (
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
            Expired
          </Badge>
        );
      case 'revoked':
        return (
          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
            Revoked
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const parseDN = (dn: string) => {
    const parts: Record<string, string> = {};
    const regex = /([A-Z]+)=([^,]+)/g;
    let match;
    while ((match = regex.exec(dn)) !== null) {
      parts[match[1]] = match[2];
    }
    return parts;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const SortIcon = ({ active, order }: { active: boolean; order: SortOrder }) => {
    if (!active) return <span className="ml-1 text-muted-foreground">↕</span>;
    return <span className="ml-1">{order === 'asc' ? '↑' : '↓'}</span>;
  };

  const hasNextPage = casQuery.data && casQuery.data.length === limit;
  const hasPrevPage = page > 0;

  return (
    <div className="px-4 py-6 sm:px-0">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Certificate Authorities</CardTitle>
              <CardDescription>
                Manage your root Certificate Authorities
              </CardDescription>
            </div>
            <Button>Create CA</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters and Search */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Input
              placeholder="Search by CN, O, OU..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0); // Reset to first page on search
              }}
              className="sm:max-w-xs"
            />
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as Status | 'all');
                setPage(0);
              }}
            >
              <SelectTrigger className="sm:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={algorithm}
              onValueChange={(value) => {
                setAlgorithm(value as Algorithm | 'all');
                setPage(0);
              }}
            >
              <SelectTrigger className="sm:w-[180px]">
                <SelectValue placeholder="Algorithm" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Algorithms</SelectItem>
                <SelectItem value="RSA-2048">RSA-2048</SelectItem>
                <SelectItem value="RSA-4096">RSA-4096</SelectItem>
                <SelectItem value="ECDSA-P256">ECDSA-P256</SelectItem>
                <SelectItem value="ECDSA-P384">ECDSA-P384</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Loading State */}
          {casQuery.isLoading && (
            <div className="flex justify-center py-8">
              <p className="text-sm text-muted-foreground">Loading Certificate Authorities...</p>
            </div>
          )}

          {/* Error State */}
          {casQuery.error && (
            <div className="rounded-md border border-destructive bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">
                Error loading Certificate Authorities
              </p>
              <p className="text-sm text-destructive/80 mt-1">
                {casQuery.error.message}
              </p>
            </div>
          )}

          {/* Empty State */}
          {casQuery.data && casQuery.data.length === 0 && (
            <div className="text-center py-12 border rounded-md border-dashed">
              <p className="text-sm text-muted-foreground mb-4">
                No Certificate Authorities found
              </p>
              <Button>Create Your First CA</Button>
            </div>
          )}

          {/* Table */}
          {casQuery.data && casQuery.data.length > 0 && (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('name')}
                      >
                        Common Name
                        <SortIcon active={sortBy === 'name'} order={sortOrder} />
                      </TableHead>
                      <TableHead className="hidden md:table-cell">
                        Organization
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Algorithm
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('issuedDate')}
                      >
                        Issued
                        <SortIcon active={sortBy === 'issuedDate'} order={sortOrder} />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 hidden sm:table-cell"
                        onClick={() => handleSort('expiryDate')}
                      >
                        Expires
                        <SortIcon active={sortBy === 'expiryDate'} order={sortOrder} />
                      </TableHead>
                      <TableHead className="text-right hidden xl:table-cell">
                        Certificates
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {casQuery.data.map((ca) => {
                      const dnParts = parseDN(ca.subject);
                      return (
                        <TableRow
                          key={ca.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleRowClick(ca.id)}
                        >
                          <TableCell className="font-medium">
                            {dnParts.CN || 'N/A'}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {dnParts.O || 'N/A'}
                          </TableCell>
                          <TableCell>{getStatusBadge(ca.status)}</TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {ca.keyAlgorithm}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(ca.notBefore)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                            {formatDate(ca.notAfter)}
                          </TableCell>
                          <TableCell className="text-right hidden xl:table-cell">
                            {ca.certificateCount}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Showing {page * limit + 1} to {page * limit + casQuery.data.length} results
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={!hasPrevPage}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!hasNextPage}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
