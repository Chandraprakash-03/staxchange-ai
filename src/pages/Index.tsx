import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

// Configure your Node.js API base URL
const API_BASE = process.env.NODE_ENV === 'production' 
  ? 'https://your-api-domain.com'  // Replace with your production API URL
  : 'http://localhost:3000';

function useGithubToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#github_token=")) {
      const t = decodeURIComponent(hash.replace("#github_token=", ""));
      // Store token in memory instead of localStorage for this session
      setToken(t);
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const logout = () => {
    setToken(null);
  };

  return { token, logout } as const;
}

interface Repo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
}

interface ConvertedFile { 
  path: string; 
  content: string; 
}

const Index = () => {
  const { token, logout } = useGithubToken();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [targetLang, setTargetLang] = useState("csharp");
  const [targetFramework, setTargetFramework] = useState("angular");
  const [targetDb, setTargetDb] = useState("postgresql");
  const [converted, setConverted] = useState<ConvertedFile[] | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [newRepoName, setNewRepoName] = useState("converted-repo");
  
  const canConvert = useMemo(() => !!token && selectedRepo && selectedBranch, [token, selectedRepo, selectedBranch]);

  const startGithubLogin = () => {
    const returnTo = window.location.origin;
    window.location.href = `${API_BASE}/api/auth/github?return_to=${encodeURIComponent(returnTo)}`;
  };

  const fetchRepos = async () => {
    if (!token) return;
    setLoadingRepos(true);
    
    try {
      const response = await fetch(`${API_BASE}/api/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setRepos(data?.repos ?? []);
    } catch (error) {
      console.error('Failed to load repos:', error);
      toast({ 
        title: "Failed to load repos", 
        description: error instanceof Error ? error.message : "Unknown error occurred"
      });
    } finally {
      setLoadingRepos(false);
    }
  };

  const fetchBranches = async (fullName: string) => {
    if (!token) return;
    const [owner, repo] = fullName.split("/");
    
    try {
      const response = await fetch(`${API_BASE}/api/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          token, 
          action: "branches", 
          owner, 
          repo 
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setBranches((data?.branches ?? []).map((b: any) => b.name));
      setSelectedBranch(data?.default ?? (data?.branches?.[0]?.name ?? ""));
    } catch (error) {
      console.error('Failed to load branches:', error);
      toast({ 
        title: "Failed to load branches", 
        description: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  };

  const runConversion = async () => {
    if (!token || !selectedRepo || !selectedBranch) return;
    const [owner, repo] = selectedRepo.split("/");
    setConvLoading(true);
    
    try {
      const response = await fetch(`${API_BASE}/api/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          owner,
          repo,
          branch: selectedBranch,
          target: { 
            language: targetLang, 
            framework: targetFramework, 
            database: targetDb 
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setConverted(data?.files ?? null);
      toast({ 
        title: "Conversion complete", 
        description: `Converted ${data?.files?.length ?? 0} files.` 
      });
    } catch (error) {
      console.error('Conversion failed:', error);
      toast({ 
        title: "Conversion failed", 
        description: error instanceof Error ? error.message : "Unknown error occurred"
      });
    } finally {
      setConvLoading(false);
    }
  };

  const exportToGithub = async () => {
    if (!token || !converted?.length) return;
    
    try {
      // Note: You'll need to implement this endpoint in your Node.js server
      const response = await fetch(`${API_BASE}/api/github/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          token, 
          repoName: newRepoName, 
          files: converted 
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data?.html_url) {
        window.open(data.html_url, "_blank");
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast({ 
        title: "Export failed", 
        description: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  };

  const exportZip = async () => {
    if (!converted?.length) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/export/zip`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json" 
        },
        body: JSON.stringify({ files: converted }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "converted.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('ZIP export failed:', error);
      toast({ 
        title: "ZIP export failed", 
        description: "Please try again." 
      });
    }
  };

  useEffect(() => {
    if (token) fetchRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen bg-background">
      <header className="container py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">StaxChange AI</h1>
          {token ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Connected to GitHub</span>
              <Button variant="outline" onClick={logout}>Logout</Button>
            </div>
          ) : (
            <Button onClick={startGithubLogin}>Login with GitHub</Button>
          )}
        </div>
      </header>

      <main className="container pb-16 space-y-8">
        <section className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Select Repository</CardTitle>
              <CardDescription>Choose a repository and branch to convert.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Repository</Label>
                <Select 
                  onValueChange={(v) => { 
                    setSelectedRepo(v); 
                    fetchBranches(v); 
                  }} 
                  disabled={!token || loadingRepos}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      token 
                        ? (loadingRepos ? "Loading repos..." : "Select a repository") 
                        : "Login to load repos"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map((r) => (
                      <SelectItem key={r.id} value={r.full_name}>
                        {r.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select 
                  onValueChange={setSelectedBranch} 
                  value={selectedBranch} 
                  disabled={!branches.length}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      branches.length ? "Select a branch" : "No branches"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Target Stack</CardTitle>
              <CardDescription>Pick your desired stack.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csharp">C#</SelectItem>
                    <SelectItem value="typescript">TypeScript</SelectItem>
                    <SelectItem value="python">Python</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Framework</Label>
                <Select value={targetFramework} onValueChange={setTargetFramework}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="angular">Angular</SelectItem>
                    <SelectItem value="react">React</SelectItem>
                    <SelectItem value="dotnet-webapi">.NET Web API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Database</Label>
                <Select value={targetDb} onValueChange={setTargetDb}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postgresql">PostgreSQL</SelectItem>
                    <SelectItem value="mysql">MySQL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3">
                <Button 
                  className="w-full" 
                  disabled={!canConvert || convLoading} 
                  onClick={runConversion}
                >
                  {convLoading ? "Converting..." : "Run Conversion"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>3. Export</CardTitle>
              <CardDescription>Push to GitHub or download a ZIP.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>New GitHub Repo Name</Label>
                <Input 
                  value={newRepoName} 
                  onChange={(e) => setNewRepoName(e.target.value)} 
                  placeholder="converted-repo" 
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Button 
                  onClick={exportToGithub} 
                  disabled={!converted?.length}
                >
                  Export to GitHub
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={exportZip} 
                  disabled={!converted?.length}
                >
                  Download ZIP
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Converted Files</CardTitle>
              <CardDescription>Preview of what was generated.</CardDescription>
            </CardHeader>
            <CardContent>
              {converted?.length ? (
                <Tabs defaultValue={converted[0]?.path} className="w-full">
                  <TabsList className="max-w-full overflow-x-auto">
                    {converted.slice(0, 6).map((f) => (
                      <TabsTrigger 
                        key={f.path} 
                        value={f.path} 
                        className="truncate max-w-[12rem]"
                      >
                        {f.path}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {converted.slice(0, 6).map((f) => (
                    <TabsContent key={f.path} value={f.path}>
                      <pre className="p-4 text-sm bg-secondary rounded-md overflow-auto max-h-[360px]">
                        <code>{f.content}</code>
                      </pre>
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Run a conversion to preview files.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
};

export default Index;