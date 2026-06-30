package main

import (
	"flag"
	"fmt"
	"os"

	cmapi "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"

	pkiv1 "github.com/oriolrius/pki-manager-issuer/api/v1alpha1"
	"github.com/oriolrius/pki-manager-issuer/internal/controllers"
)

var scheme = runtime.NewScheme()

func init() {
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(pkiv1.AddToScheme(scheme))
	utilruntime.Must(cmapi.AddToScheme(scheme))
}

func main() {
	var (
		metricsAddr             string
		probeAddr               string
		enableLeaderElection    bool
		clusterResourceNamespace string
	)
	flag.StringVar(&metricsAddr, "metrics-bind-address", ":8080", "Metrics endpoint")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "Health probe endpoint")
	flag.BoolVar(&enableLeaderElection, "leader-elect", false, "Enable leader election")
	flag.StringVar(&clusterResourceNamespace, "cluster-resource-namespace", "",
		"Namespace to look up Secrets for ClusterIssuer (defaults to controller's namespace)")
	opts := zap.Options{Development: false}
	opts.BindFlags(flag.CommandLine)
	flag.Parse()
	ctrl.SetLogger(zap.New(zap.UseFlagOptions(&opts)))

	if clusterResourceNamespace == "" {
		clusterResourceNamespace = os.Getenv("POD_NAMESPACE")
	}
	if clusterResourceNamespace == "" {
		clusterResourceNamespace = "pki-manager-issuer"
	}

	mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
		Scheme:                  scheme,
		LeaderElection:          enableLeaderElection,
		LeaderElectionID:        "pki-manager-issuer-leader",
		HealthProbeBindAddress:  probeAddr,
	})
	if err != nil {
		fmt.Println("manager init error:", err)
		os.Exit(1)
	}

	if err := (&controllers.IssuerReconciler{
		Client:                   mgr.GetClient(),
		Scheme:                   mgr.GetScheme(),
		Kind:                     "Issuer",
		ClusterResourceNamespace: clusterResourceNamespace,
	}).SetupWithManager(mgr); err != nil {
		fmt.Println("issuer controller setup:", err)
		os.Exit(1)
	}
	if err := (&controllers.IssuerReconciler{
		Client:                   mgr.GetClient(),
		Scheme:                   mgr.GetScheme(),
		Kind:                     "ClusterIssuer",
		ClusterResourceNamespace: clusterResourceNamespace,
	}).SetupWithManager(mgr); err != nil {
		fmt.Println("clusterissuer controller setup:", err)
		os.Exit(1)
	}
	if err := (&controllers.CertificateRequestReconciler{
		Client:                   mgr.GetClient(),
		Scheme:                   mgr.GetScheme(),
		Recorder:                 mgr.GetEventRecorderFor("pki-manager-issuer"),
		ClusterResourceNamespace: clusterResourceNamespace,
	}).SetupWithManager(mgr); err != nil {
		fmt.Println("certificaterequest controller setup:", err)
		os.Exit(1)
	}

	_ = mgr.AddHealthzCheck("healthz", healthz.Ping)
	_ = mgr.AddReadyzCheck("readyz", healthz.Ping)

	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		fmt.Println("manager terminated:", err)
		os.Exit(1)
	}
}
