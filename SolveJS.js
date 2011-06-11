var INFEASIBLE = 0, OPTIMAL = 1, UNBOUNDED = 2;

function ModelClone(model) {
	if(model == null || typeof(model) != 'object') return model;
    var newModel = new model.constructor(); 
    for (var key in model) newModel[key] = ModelClone(model[key]);
    return newModel;
}

function SolveMILP(rootModel) {

    var bestFeasible = Infinity;
	var bestFeasibleX;
	var mostFracIndex, mostFracValue, fracValue;
	var unsolvedLPs = new Array();
	rootModel.solved = false;
    unsolvedLPs.push(rootModel);
	var nodeCount = 0;
	
	while (unsolvedLPs.length >= 1) {
		// Solve the LP
		nodeCount += 1;
		model = unsolvedLPs.shift();
		console.log("Solving node", nodeCount, "Nodes on tree:", unsolvedLPs.length+1);
		PrimalSimplex(model);
		if (model.status == INFEASIBLE) {
			// LP is infeasible, fathom it
			console.log("Node infeasible, fathoming.");
			continue;
		}
		console.log("LP solution at node =", model.z);
		console.log(model.x);
		// Is this worse than the best integer solution?
		if (model.z > bestFeasible) {
			// Fathom
			console.log("LP solution worse than best integer feasible, fathoming.");
			continue;
		}
		// Check integrality
		mostFracIndex = -1;
		mostFracValue = 0;
		for (i = 0; i < model.n; i++) {
			if (model.xINT[i]) {
				if (Math.abs(Math.floor(model.x[i]) - model.x[i]) > 0.0001) {
					// Does not satisfy - will need to branch
					fracValue = Math.min( Math.abs(Math.floor(model.x[i]) - model.x[i]), 
										  Math.abs(Math.ceil (model.x[i]) - model.x[i])   );
					if (fracValue > mostFracValue) {
						mostFracIndex = i;
						mostFracValue = fracValue;
					}
				}
			}
		}
		// Did we find any fractional ints?
		if (mostFracIndex == -1) {
			// No fractional ints - update best feasible
			console.log("Node is integer feasible.");
			if (model.z < bestFeasible) {
				console.log("Best integer feasible was", bestFeasible, ", is now", model.z);
				bestFeasible = model.z;
				bestFeasibleX = new Array(model.n);
				for (i = 0; i < model.n; i++) bestFeasibleX[i] = model.x[i];
			}
		} else {
			// Some fractional - create two new LPs to solve
			console.log("Node is fractional, branching on most fractional variable,", mostFracIndex);
			downBranchModel = ModelClone(model);
			downBranchModel.xUB[mostFracIndex] = Math.floor(downBranchModel.x[mostFracIndex])
			downBranchModel.z = model.z;
			unsolvedLPs.push(downBranchModel);
			
			upBranchModel = ModelClone(model);
			upBranchModel.xLB[mostFracIndex] = Math.ceil(upBranchModel.x[mostFracIndex])
			upBranchModel.z = model.z;
			unsolvedLPs.push(upBranchModel);
		}
		
	}
	
	// How did it go?
	if (bestFeasible < Infinity) {
		// Done!
		console.log("All nodes solved or fathmoed - integer solution found,");
		rootModel.x = bestFeasibleX;
		rootModel.z = bestFeasible;
		rootModel.status = OPTIMAL;
	} else {
		console.log("All nodes solved or fathmoed - NO integer solution found,");
		rootModel.status = INFEASIBLE;
	}
	
}


function PrimalSimplex(model) {
    
    A=model.A; b=model.b; c=model.c;
    m=model.m; n=model.n;
    xLB=model.xLB; xUB=model.xUB;
    
    // Define some temporary variables we will need for RSM
    var i, j;
    var varStatus = new Array(n + m);
    var basicVars = new Array(m);
    var Binv      = new Array(m); 
    for (i = 0; i < m; i++) { Binv[i] = new Array(m); }
    var cBT       = new Array(m);
    var pi        = new Array(m);
    var rc        = new Array(n);
    var BinvAs    = new Array(m);
    
    // Some useful constants
    var BASIC = 0, NONBASIC_L = +1, NONBASIC_U = -1;
    var TOL = 0.000001;
    
    // The solution
    var x = new Array(n + m), z, status;
    
    // Create the initial solution to Phase 1
    // - Real variables
    for (i = 0; i < n; i++) {
        var absLB = Math.abs(xLB[i]);
        var absUB = Math.abs(xUB[i]);
        x[i]         = (absLB < absUB) ? xLB[i]     : xUB[i]    ;
        varStatus[i] = (absLB < absUB) ? NONBASIC_L : NONBASIC_U;
    }
    // - Artificial variables
    for (i = 0; i < m; i++) {
        x[i+n] = b[i];
        // Some of the real variables might be non-zero, so need
        // to reduce x[artificials] accordingly
        for (j = 0; j < n; j++) { x[i+n] -= A[i][j] * x[j]; }
        varStatus[i+n] = BASIC;
        basicVars[i] = i+n;
    }
    // - Basis
    for (i = 0; i < m; i++) { cBT[i] = +1.0; }
    for (i = 0; i < m; i++) {
        for (j = 0; j < m; j++) {
            Binv[i][j] = (i == j) ? 1.0 : 0.0;
        }
    }
    
    // Being simplex iterations
    var phaseOne = true;
    while (true) {
        //---------------------------------------------------------------------
        // Step 1. Duals and reduced Costs
        //console.log(Binv)
        for (i = 0; i < m; i++) {
            pi[i] = 0.0;
            for (j = 0; j < m; j++) {
                pi[i] += cBT[j] * Binv[j][i]
            }
        }
        //console.log(pi);
        for (j = 0; j < n; j++) {
            rc[j] = phaseOne ? 0.0 : c[j];
            for (i = 0; i < m; i++) {
                rc[j] -= pi[i] * A[i][j];
            }
        }
        //console.log(rc);
        //---------------------------------------------------------------------
        
        //---------------------------------------------------------------------
        // Step 2. Check optimality and pick entering variable
        var minRC = -TOL, s = -1;
        for (i = 0; i < n; i++) {
            // If NONBASIC_L (= +1), rc[i] must be negative (< 0) -> +rc[i] < -TOL
            // If NONBASIC_U (= -1), rc[i] must be positive (> 0) -> -rc[i] < -TOL
            //                                                      -> +rc[i] > +TOL
            // If BASIC    (= 0), can't use this rc -> 0 * rc[i] < -LPG_TOL -> alway FALSE
            // Then, by setting initial value of minRC to -TOL, can collapse this
            // check and the check for a better RC into 1 IF statement!
            if (varStatus[i] * rc[i] < minRC) { 
                minRC = varStatus[i] * rc[i];
                s = i; 
            }
        }
        //console.log(minRC, s);
        // If no entering variable
        if (s == -1) {
            if (phaseOne) {
                //console.log("Phase one optimal")
                z = 0.0;
                for (i = 0; i < m; i++) z += cBT[i] * x[basicVars[i]];
                if (z > TOL) {
                    //console.log("Phase 1 objective: z = ", z, " > 0 -> infeasible!");
                    model.status = INFEASIBLE;
                    break;
                } else {
                    //console.log("Transitioning to phase 2");
                    phaseOne = false;
                    for (i = 0; i < m; i++) {
                        cBT[i] = (basicVars[i] < n) ? (c[basicVars[i]]) : (0.0);
                    }
                    continue;
                }
            } else {
                model.status = OPTIMAL;
                z = 0.0;
                for (i = 0; i < n; i++) {
                    z += c[i] * x[i];
                }
                model.z = z;
                model.x = x;
                //console.log("Optimality in Phase 2!",z);
                //console.log(x);
                break;
            }
        }
        //---------------------------------------------------------------------
        
        //---------------------------------------------------------------------
        // Step 3. Calculate BinvAs
        for (i = 0; i < m; i++) {
            BinvAs[i] = 0.0;
            for (k = 0; k < m; k++) BinvAs[i] += Binv[i][k] * A[k][s];
        }
        //console.log(BinvAs);
        //---------------------------------------------------------------------
        
        //---------------------------------------------------------------------
        // Step 4. Ratio test
        var minRatio = Infinity, ratio = 0.0, r = -1;
        var rIsEV = false;
        // If EV is...
        // NBL, -> rc[s] < 0 -> want to INCREASE x[s]
        // NBU, -> rc[s] > 0 -> want to DECREASE x[s]
        // Option 1: Degenerate iteration
        ratio = xUB[s] - xLB[s];
        if (ratio <= minRatio) { minRatio = ratio; r = -1; rIsEV = true; }
        // Option 2: Basic variables leaving basis
        for (i = 0; i < m; i++) {
            j = basicVars[i];
            var jLB = (j >= n) ? 0.0 : xLB[j];
            var jUB = (j >= n) ? Infinity : xUB[j];
            if (-1*varStatus[s]*BinvAs[i] > +TOL) { // NBL: BinvAs[i] < 0, NBU: BinvAs[i] > 0
                ratio = (x[j] - jUB) / (varStatus[s]*BinvAs[i]);
                if (ratio <= minRatio) { minRatio = ratio; r = i; rIsEV = false; }
            }
            if (+1*varStatus[s]*BinvAs[i] > +TOL) { // NBL: BinvAs[i] > 0, NBU: BinvAs[i] < 0
                ratio = (x[j] - jLB) / (varStatus[s]*BinvAs[i]);
                if (ratio <= minRatio) { minRatio = ratio; r = i; rIsEV = false; }
            }
        }
            
        // Check ratio
        if (minRatio >= Infinity) {
            if (phaseOne) {
                // Not sure what this means - nothing good!
                //console.log("Something bad happened");
				break;
            } else {
                // PHASE 2: Unbounded!
                model.status = UNBOUNDED;
                //console.log("Unbounded in Phase 2!");
                break;
            }
        }
        //---------------------------------------------------------------------
        
        //---------------------------------------------------------------------
        // Step 5. Update solution and basis
        x[s] += varStatus[s] * minRatio;
        for (i = 0; i < m; i++) x[basicVars[i]] -= varStatus[s] * minRatio * BinvAs[i];

        if (!rIsEV) {
            // Basis change! Update Binv, flags
            // RSM tableau: [Binv B | Binv | Binv As]
            // -> GJ pivot on the BinvAs column, rth row
            var erBinvAs = BinvAs[r];
            // All non-r rows
            for (i = 0; i < m; i++) {
                if (i != r) {
                    var eiBinvAsOvererBinvAs = BinvAs[i] / erBinvAs;
                    for (j = 0; j < m; j++) {
                        Binv[i][j] -= eiBinvAsOvererBinvAs * Binv[r][j]
                    }
                }
            }
            // rth row
            for (j = 0; j < m; j++) Binv[r][j] /= erBinvAs;

            // Update status flags
            varStatus[s] = BASIC;
            if (basicVars[r] < n) {
                if (Math.abs(x[basicVars[r]] - xLB[basicVars[r]]) < TOL) varStatus[basicVars[r]] = NONBASIC_L;
                if (Math.abs(x[basicVars[r]] - xUB[basicVars[r]]) < TOL) varStatus[basicVars[r]] = NONBASIC_U;
            } else {
                if (Math.abs(x[basicVars[r]] - 0.00000) < TOL) varStatus[basicVars[r]] = NONBASIC_L;
                if (Math.abs(x[basicVars[r]] - Infinity) < TOL) varStatus[basicVars[r]] = NONBASIC_U;
            }
            cBT[r] = phaseOne ? 0.0 : c[s];
            basicVars[r] = s;

        } else {
            // Degenerate iteration
            if (varStatus[s] == NONBASIC_L) { varStatus[s] = NONBASIC_U; }
            else { varStatus[s] = NONBASIC_L; }
        }
        //---------------------------------------------------------------------
        //console.log(x);
    }
}


function TestPrimalSimplex() {
    var test = new Object();
    test.A = [[ 2, 1, 1, 0],
              [20, 1, 0, 1]];
    test.b = [40, 100];
    test.c = [-10, -1, 0, 0];
    test.m = 2;
    test.n = 4;
    test.xLB = [2, 0, 0, 0];
    test.xUB = [3, Infinity, Infinity, Infinity];
    PrimalSimplex(test);
    // Should be 3, 34, 0, 6
}

function TestBandB() {
    var test = new Object();
    test.A = [[ 1, 1, 0, 1, 0, 0],
              [ 0, 1, 1, 0, 1, 0],
			  [.5,.5, 1, 1, 0, 1]];
    test.b =  [ 1, 1, 1];
    test.c =  [-1,-1,-1, 0, 0, 0];
    test.m = 3;
    test.n = 6;
    test.xLB = [0, 0, 0, 0, 0, 0];
    test.xUB = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
	test.xINT = [true, true, true, false, false, false];
    SolveMILP(test);
	console.log(test.x, test.z);
    // Should be 1, 0, 0, 0, 1, 0.5, z=-1
	//        or 0, 1, 0, 0, 0, 0.5, z=-1
}

TestBandB();